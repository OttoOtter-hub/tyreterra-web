import { WhereExpressionBuilder } from 'typeorm';
import { AllowedRoles, Listing, ListingStatus } from './entities/listing.entity';
import { User, UserRole } from '../auth/entities/user.entity';

// Who may see a listing. One rule for the catalogue search (SQL below), a
// single listing by id, and everything that reaches a listing by its id
// (creating a request, owner actions). A listing the viewer may not see is
// answered with 404, never 403, so its existence is not revealed.
//
//   - deleted: nobody
//   - the owner (seller company) and admins: always, whatever the status
//   - everyone else, all of:
//       status active and not past expires_at;
//       allowed_roles is "all" or the viewer's role;
//       exclude_own_region: the viewer's company is not in the seller's country;
//       visible_regions (if set): the viewer's company country is listed.
//     A viewer without a company has no country: region-limited listings
//     are hidden from them.

export interface VisibilityContext {
  /** Country of the seller company */
  sellerCountry: string | null;
  /** Country of the viewer's company, null without one */
  viewerCountry: string | null;
}

export function isOwner(listing: Pick<Listing, 'company_id'>, viewer: User): boolean {
  return !!viewer.company_id && listing.company_id === viewer.company_id;
}

/** May the viewer see this listing? */
export function canSeeListing(listing: Listing, viewer: User, ctx: VisibilityContext, now = new Date()): boolean {
  if (listing.deleted_at) return false;
  if (isOwner(listing, viewer) || viewer.role === UserRole.ADMIN) return true;
  if (listing.status !== ListingStatus.ACTIVE) return false;
  if (listing.expires_at && new Date(listing.expires_at) <= now) return false;
  if (listing.allowed_roles !== AllowedRoles.ALL && (listing.allowed_roles as string) !== viewer.role) return false;
  if (listing.exclude_own_region && ctx.viewerCountry !== null && ctx.viewerCountry === ctx.sellerCountry) return false;
  const regions = listing.visible_regions ?? [];
  if (regions.length > 0 && (ctx.viewerCountry === null || !regions.includes(ctx.viewerCountry))) return false;
  return true;
}

/**
 * The same rule as SQL, for listings `alias` that are already limited to
 * active, not deleted, not expired ones (the catalogue). Expects the seller
 * company joined as `sellerAlias` and the viewer's company as `viewerAlias`,
 * joined on :viewerCompanyId (so NULL without one).
 */
export function whereListingVisibleTo(
  qb: WhereExpressionBuilder,
  alias: string,
  sellerAlias: string,
  viewerAlias: string,
  viewer: User,
): void {
  if (viewer.role === UserRole.ADMIN) return;
  qb.andWhere(
    `(${alias}.company_id = :viewerCompanyId OR (
        (${alias}.allowed_roles = :rolesAll OR ${alias}.allowed_roles::text = :viewerRole)
        AND (${alias}.exclude_own_region = false OR ${viewerAlias}.country IS NULL
             OR ${viewerAlias}.country IS DISTINCT FROM ${sellerAlias}.country)
        AND (${alias}.visible_regions IS NULL OR cardinality(${alias}.visible_regions) = 0
             OR ${viewerAlias}.country = ANY(${alias}.visible_regions))
      ))`,
    { viewerCompanyId: viewer.company_id ?? null, rolesAll: AllowedRoles.ALL, viewerRole: viewer.role },
  );
}

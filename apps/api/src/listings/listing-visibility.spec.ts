import { canSeeListing, VisibilityContext } from './listing-visibility';
import { AllowedRoles, Listing, ListingStatus } from './entities/listing.entity';
import { User, UserRole } from '../auth/entities/user.entity';

const NOW = new Date('2026-10-29T12:00:00Z');
const FUTURE = new Date('2026-11-28T12:00:00Z');
const PAST = new Date('2026-10-01T12:00:00Z');

const listing = (over: Partial<Listing> = {}): Listing => ({
  company_id: 'seller-co',
  status: ListingStatus.ACTIVE,
  expires_at: FUTURE,
  deleted_at: null,
  allowed_roles: AllowedRoles.ALL,
  exclude_own_region: false,
  visible_regions: null,
  ...over,
}) as Listing;

const user = (over: Partial<User> = {}): User => ({ id: 'u', company_id: 'buyer-co', role: UserRole.DEALER, ...over }) as User;
const owner = user({ company_id: 'seller-co' });
const admin = user({ company_id: 'admin-co', role: UserRole.ADMIN });

const DE_PL: VisibilityContext = { sellerCountry: 'DE', viewerCountry: 'PL' };
const DE_DE: VisibilityContext = { sellerCountry: 'DE', viewerCountry: 'DE' };
const DE_NONE: VisibilityContext = { sellerCountry: 'DE', viewerCountry: null };

const sees = (l: Listing, u: User, ctx = DE_PL) => canSeeListing(l, u, ctx, NOW);

describe('canSeeListing', () => {
  it('an active, unrestricted listing is visible to anyone', () => {
    expect(sees(listing(), user())).toBe(true);
    expect(sees(listing(), user({ company_id: null }), DE_NONE)).toBe(true);
  });

  describe('status', () => {
    it.each([ListingStatus.INACTIVE, ListingStatus.EXPIRED])('%s: only the owner and admins', (status) => {
      const l = listing({ status });
      expect(sees(l, user())).toBe(false);
      expect(sees(l, owner, DE_DE)).toBe(true);
      expect(sees(l, admin)).toBe(true);
    });

    it('active but past expires_at: only the owner and admins', () => {
      const l = listing({ expires_at: PAST });
      expect(sees(l, user())).toBe(false);
      expect(sees(l, owner, DE_DE)).toBe(true);
      expect(sees(l, admin)).toBe(true);
    });

    it('deleted: nobody, the owner included', () => {
      const l = listing({ deleted_at: PAST });
      expect(sees(l, user())).toBe(false);
      expect(sees(l, owner, DE_DE)).toBe(false);
      expect(sees(l, admin)).toBe(false);
    });
  });

  describe('allowed_roles', () => {
    it('dealer-only listing: dealers yes, distributors no', () => {
      const l = listing({ allowed_roles: AllowedRoles.DEALER });
      expect(sees(l, user({ role: UserRole.DEALER }))).toBe(true);
      expect(sees(l, user({ role: UserRole.DISTRIBUTOR }))).toBe(false);
    });

    it('distributor-only listing: distributors yes, dealers no', () => {
      const l = listing({ allowed_roles: AllowedRoles.DISTRIBUTOR });
      expect(sees(l, user({ role: UserRole.DISTRIBUTOR }))).toBe(true);
      expect(sees(l, user({ role: UserRole.DEALER }))).toBe(false);
    });

    it('the owner sees it whatever their role', () => {
      expect(sees(listing({ allowed_roles: AllowedRoles.DISTRIBUTOR }), owner, DE_DE)).toBe(true);
    });
  });

  describe('exclude_own_region', () => {
    const l = listing({ exclude_own_region: true });
    it('hidden from companies in the seller country', () => expect(sees(l, user(), DE_DE)).toBe(false));
    it('visible from other countries', () => expect(sees(l, user(), DE_PL)).toBe(true));
    it('visible to a viewer without a company (no country to exclude)', () =>
      expect(sees(l, user({ company_id: null }), DE_NONE)).toBe(true));
    it('the owner still sees it', () => expect(sees(l, owner, DE_DE)).toBe(true));
  });

  describe('visible_regions', () => {
    const l = listing({ visible_regions: ['PL', 'CZ'] });
    it('visible in a listed country', () => expect(sees(l, user(), DE_PL)).toBe(true));
    it('hidden elsewhere', () => expect(sees(l, user(), { sellerCountry: 'DE', viewerCountry: 'FR' })).toBe(false));
    it('hidden from a viewer without a company', () => expect(sees(l, user({ company_id: null }), DE_NONE)).toBe(false));
    it('an empty list means no limit', () => expect(sees(listing({ visible_regions: [] }), user(), DE_DE)).toBe(true));
    it('the owner still sees it', () => expect(sees(l, owner, DE_DE)).toBe(true));
  });

  it('admins see every listing that is not deleted', () => {
    const l = listing({ allowed_roles: AllowedRoles.DISTRIBUTOR, exclude_own_region: true, visible_regions: ['FR'] });
    expect(sees(l, admin, DE_DE)).toBe(true);
  });
});

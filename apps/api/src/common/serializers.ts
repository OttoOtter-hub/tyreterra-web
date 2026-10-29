import { Listing } from '../listings/entities/listing.entity';
import { Company } from '../companies/entities/company.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Request } from '../requests/entities/request.entity';
import { Deal } from '../deals/entities/deal.entity';
import { User } from '../auth/entities/user.entity';
import { isOwner } from '../listings/listing-visibility';
import { EncryptionService } from './encryption.service';

// What a listing (and what hangs off it) may carry out of the API. Every
// response that contains a listing, company, offer, request or deal goes
// through these functions:
//   - ciphertext never leaves the API;
//   - the internal (recommended) price of a listing reaches only its owner,
//     decrypted, as `price` / `currency`;
//   - an offer price reaches the deal participants decrypted, as `price`
//     (callers have already checked that the viewer is one of them);
//   - company contacts are revealed only by accepting an offer (§7.2), never here.
// The e2e suite checks every listing-returning endpoint for SECRET_FIELDS.

export const SECRET_FIELDS = [
  'price_internal_encrypted', // listing
  'price_currency', // listing — reaches the owner as `currency`
  'contact_email_encrypted', // company
  'contact_phone_encrypted', // company
  'price_encrypted', // offer
] as const;

type Decryptor = Pick<EncryptionService, 'tryDecrypt'>;

export type PublicCompany = Omit<Company, 'contact_email_encrypted' | 'contact_phone_encrypted'>;

export type SerializedListing = Omit<Listing, 'price_internal_encrypted' | 'price_currency' | 'company'> & {
  company?: PublicCompany | null;
  /** Owner only */
  price?: number | null;
  /** Owner only */
  currency?: string | null;
};

export type SerializedOffer = Omit<Offer, 'price_encrypted' | 'request'> & {
  price: number | null;
  request?: SerializedRequest | null;
};

export type SerializedRequest = Omit<Request, 'listing' | 'buyer_company' | 'offer'> & {
  listing?: SerializedListing | null;
  buyer_company?: PublicCompany | null;
  offer?: SerializedOffer | null;
};

export type SerializedDeal = Omit<Deal, 'offer'> & { offer?: SerializedOffer | null };

const toPrice = (plain: string | null): number | null => (plain === null ? null : parseFloat(plain));

export function serializeCompany(company: Company): PublicCompany {
  const { contact_email_encrypted, contact_phone_encrypted, ...rest } = company;
  return rest;
}

export function serializeListing(listing: Listing, viewer: User, crypto: Decryptor): SerializedListing {
  const { price_internal_encrypted, price_currency, company, ...rest } = listing;
  const out: SerializedListing = { ...rest };
  // Relations are passed on only when they were loaded
  if (company !== undefined) out.company = company && serializeCompany(company);
  if (isOwner(listing, viewer)) {
    out.price = toPrice(crypto.tryDecrypt(price_internal_encrypted));
    out.currency = price_currency;
  }
  return out;
}

export function serializeOffer(offer: Offer, viewer: User, crypto: Decryptor): SerializedOffer {
  const { price_encrypted, request, ...rest } = offer;
  const out: SerializedOffer = { ...rest, price: toPrice(crypto.tryDecrypt(price_encrypted)) };
  if (request !== undefined) out.request = request && serializeRequest(request, viewer, crypto);
  return out;
}

export function serializeRequest(request: Request, viewer: User, crypto: Decryptor): SerializedRequest {
  const { listing, buyer_company, offer, ...rest } = request;
  const out: SerializedRequest = { ...rest };
  if (listing !== undefined) out.listing = listing && serializeListing(listing, viewer, crypto);
  if (buyer_company !== undefined) out.buyer_company = buyer_company && serializeCompany(buyer_company);
  if (offer !== undefined) out.offer = offer && serializeOffer(offer, viewer, crypto);
  return out;
}

export function serializeDeal(deal: Deal, viewer: User, crypto: Decryptor): SerializedDeal {
  const { offer, ...rest } = deal;
  const out: SerializedDeal = { ...rest };
  if (offer !== undefined) out.offer = offer && serializeOffer(offer, viewer, crypto);
  return out;
}

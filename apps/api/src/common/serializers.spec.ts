import { serializeCompany, serializeDeal, serializeListing, serializeOffer, serializeRequest, SECRET_FIELDS } from './serializers';
import { Listing } from '../listings/entities/listing.entity';
import { Company } from '../companies/entities/company.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Request } from '../requests/entities/request.entity';
import { Deal } from '../deals/entities/deal.entity';
import { User } from '../auth/entities/user.entity';

// Stand-in for EncryptionService: "enc(x)" decrypts to "x"
const crypto = { tryDecrypt: (c: string | null | undefined) => (c?.startsWith('enc(') ? c.slice(4, -1) : null) };

const company = (id: string): Company => ({
  id, name: `Co ${id}`, country: 'DE',
  contact_email_encrypted: 'enc(a@b.c)', contact_phone_encrypted: 'enc(+49)',
}) as Company;

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'l1', company_id: 'seller', brand: 'B', qty: 4,
  price_internal_encrypted: 'enc(123.45)', price_currency: 'USD', ...over,
}) as Listing;

const owner = { id: 'u1', company_id: 'seller' } as User;
const buyer = { id: 'u2', company_id: 'buyer' } as User;

const secretKeys = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(secretKeys)
    : v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => [...((SECRET_FIELDS as readonly string[]).includes(k) ? [k] : []), ...secretKeys(x)])
      : [];

describe('serializers', () => {
  it('company: drops the encrypted contacts, keeps the rest', () => {
    expect(serializeCompany(company('c'))).toEqual({ id: 'c', name: 'Co c', country: 'DE' });
  });

  describe('listing', () => {
    it('owner: decrypted price and currency, no ciphertext', () => {
      const out = serializeListing(listing(), owner, crypto);
      expect(out).toMatchObject({ id: 'l1', price: 123.45, currency: 'USD' });
      expect(secretKeys(out)).toEqual([]);
    });

    it('owner without a price: price null', () => {
      expect(serializeListing(listing({ price_internal_encrypted: null, price_currency: null }), owner, crypto))
        .toMatchObject({ price: null, currency: null });
    });

    it('anyone else: no price fields at all', () => {
      const out = serializeListing(listing(), buyer, crypto);
      expect(out).not.toHaveProperty('price');
      expect(out).not.toHaveProperty('currency');
      expect(secretKeys(out)).toEqual([]);
    });

    it('a loaded company is passed on without contacts; an unloaded one is not added', () => {
      expect(serializeListing(listing({ company: company('seller') }), buyer, crypto).company)
        .toEqual({ id: 'seller', name: 'Co seller', country: 'DE' });
      expect(serializeListing(listing(), buyer, crypto)).not.toHaveProperty('company');
    });
  });

  it('request → offer → deal: nested listing, companies and offer are all serialized', () => {
    const offer = { id: 'o1', price_encrypted: 'enc(99)', currency: 'EUR' } as Offer;
    const req = {
      id: 'r1', listing: listing({ company: company('seller') }), buyer_company: company('buyer'), offer,
    } as Request;
    const deal = { id: 'd1', offer: { ...offer, request: req } } as Deal;

    for (const viewer of [owner, buyer]) {
      const out = serializeDeal(deal, viewer, crypto);
      expect(secretKeys(out)).toEqual([]);
      expect(out.offer?.price).toBe(99);
      expect(out.offer?.request?.buyer_company).toEqual({ id: 'buyer', name: 'Co buyer', country: 'DE' });
    }
    expect(serializeDeal(deal, owner, crypto).offer?.request?.listing?.price).toBe(123.45);
    expect(serializeDeal(deal, buyer, crypto).offer?.request?.listing).not.toHaveProperty('price');

    expect(serializeRequest(req, buyer, crypto).offer?.price).toBe(99);
    expect(serializeOffer(offer, buyer, crypto)).toEqual({ id: 'o1', currency: 'EUR', price: 99 });
  });

  it('undecryptable ciphertext reads as null', () => {
    expect(serializeListing(listing({ price_internal_encrypted: 'garbage' }), owner, crypto).price).toBeNull();
  });
});

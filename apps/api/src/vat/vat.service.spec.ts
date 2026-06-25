import { ServiceUnavailableException } from '@nestjs/common';
import { VatService } from './vat.service';

// Wrap native fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const VALID_VIES_RESPONSE = `
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <checkVatResponse xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <countryCode>DE</countryCode>
      <vatNumber>123456789</vatNumber>
      <valid>true</valid>
      <name>Acme GmbH</name>
      <address>Musterstr. 1, 10115 Berlin</address>
    </checkVatResponse>
  </env:Body>
</env:Envelope>`;

const INVALID_VIES_RESPONSE = `
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <checkVatResponse xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <countryCode>DE</countryCode>
      <vatNumber>000000000</vatNumber>
      <valid>false</valid>
      <name>---</name>
      <address>---</address>
    </checkVatResponse>
  </env:Body>
</env:Envelope>`;

const xmlResponse = (body: string) =>
  Promise.resolve({ ok: true, text: () => Promise.resolve(body) });

describe('VatService', () => {
  let service: VatService;

  beforeEach(() => {
    service = new VatService();
    service.clearCache();
    mockFetch.mockReset();
  });

  it('returns valid=true with name and address for a valid VAT', async () => {
    mockFetch.mockReturnValue(xmlResponse(VALID_VIES_RESPONSE));

    const result = await service.checkVat('DE', '123456789');

    expect(result.valid).toBe(true);
    expect(result.companyName).toBe('Acme GmbH');
    expect(result.address).toBe('Musterstr. 1, 10115 Berlin');
    expect(result.countryCode).toBe('DE');
  });

  it('returns valid=false for an invalid VAT number', async () => {
    mockFetch.mockReturnValue(xmlResponse(INVALID_VIES_RESPONSE));

    const result = await service.checkVat('DE', '000000000');

    expect(result.valid).toBe(false);
    expect(result.companyName).toBeNull();
    expect(result.address).toBeNull();
  });

  it('caches result and does not call VIES again within 24 h', async () => {
    mockFetch.mockReturnValue(xmlResponse(VALID_VIES_RESPONSE));

    await service.checkVat('DE', '123456789');
    await service.checkVat('DE', '123456789');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('strips spaces from vatNumber before lookup', async () => {
    mockFetch.mockReturnValue(xmlResponse(VALID_VIES_RESPONSE));

    await service.checkVat('DE', '123 456 789');
    // Second call with no spaces should hit cache
    await service.checkVat('DE', '123456789');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailableException when VIES is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.checkVat('DE', '123456789')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailableException on non-2xx HTTP response', async () => {
    mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 503 }));

    await expect(service.checkVat('DE', '123456789')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

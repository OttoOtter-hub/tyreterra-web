import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { VatCheckResult } from './dto/vat-check.dto';

interface CacheEntry {
  result: VatCheckResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h per §9.3

// VIES SOAP envelope template
const soapEnvelope = (countryCode: string, vatNumber: string) => `
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
  <soapenv:Body>
    <urn:checkVat>
      <urn:countryCode>${countryCode}</urn:countryCode>
      <urn:vatNumber>${vatNumber}</urn:vatNumber>
    </urn:checkVat>
  </soapenv:Body>
</soapenv:Envelope>`.trim();

@Injectable()
export class VatService {
  private readonly logger = new Logger(VatService.name);
  private readonly cache = new Map<string, CacheEntry>();

  private readonly VIES_URL =
    'https://ec.europa.eu/taxation_customs/vies/services/checkVatService';

  async checkVat(countryCode: string, vatNumber: string): Promise<VatCheckResult> {
    const key = `${countryCode}:${vatNumber.replace(/\s/g, '').toUpperCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug(`VIES cache hit: ${key}`);
      return cached.result;
    }

    const result = await this.callVies(countryCode, vatNumber.replace(/\s/g, ''));
    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  private async callVies(countryCode: string, vatNumber: string): Promise<VatCheckResult> {
    const checkedAt = new Date().toISOString();

    let response: Response;
    try {
      response = await fetch(this.VIES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: '' },
        body: soapEnvelope(countryCode, vatNumber),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // VIES is sometimes unavailable — fail gracefully (§14.5)
      this.logger.warn(`VIES unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'VAT validation service is temporarily unavailable. Please try again later.',
      );
    }

    if (!response.ok) {
      this.logger.warn(`VIES HTTP ${response.status}`);
      throw new ServiceUnavailableException('VAT validation service returned an error.');
    }

    const xml = await response.text();
    return this.parseViesResponse(xml, countryCode, vatNumber, checkedAt);
  }

  private parseViesResponse(
    xml: string,
    countryCode: string,
    vatNumber: string,
    checkedAt: string,
  ): VatCheckResult {
    // VIES fault (invalid format, country not in EU, etc.)
    if (xml.includes('INVALID_INPUT') || xml.includes('faultstring')) {
      return { valid: false, countryCode, vatNumber, companyName: null, address: null, checkedAt };
    }

    const valid = this.extractTag(xml, 'valid') === 'true';
    const companyName = this.extractTag(xml, 'name') ?? null;
    const address = this.extractTag(xml, 'address') ?? null;

    return {
      valid,
      countryCode,
      vatNumber,
      companyName: companyName === '---' ? null : companyName,
      address: address === '---' ? null : address,
      checkedAt,
    };
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}>([^<]*)<`));
    return m?.[1]?.trim();
  }

  // Exposed for testing — clears the in-process cache
  clearCache(): void {
    this.cache.clear();
  }
}

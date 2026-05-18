import { InstanceDto } from '@api/dto/instance.dto';
import { configService } from '@config/env.config';
import { BadRequestException } from '@exceptions';

import { CodMerchantDto } from '../dto/codOrder.dto';
import { CodMerchantService } from '../services/codMerchant.service';

/**
 * HTTP entry point for the COD merchant profile (dashboard settings).
 */
export class CodMerchantController {
  private readonly integrationEnabled = configService.get('CODAGENT').ENABLED;

  constructor(private readonly codMerchantService: CodMerchantService) {}

  private ensureEnabled(): void {
    if (!this.integrationEnabled) {
      throw new BadRequestException('CodAgent is disabled');
    }
  }

  public async getMerchant(instance: InstanceDto) {
    this.ensureEnabled();
    return this.codMerchantService.getMerchant(instance);
  }

  public async setMerchant(instance: InstanceDto, data: CodMerchantDto) {
    this.ensureEnabled();
    return this.codMerchantService.setMerchant(instance, data);
  }
}

import { InstanceDto } from '@api/dto/instance.dto';
import { configService } from '@config/env.config';
import { BadRequestException } from '@exceptions';

import { CreateCodOrderDto } from '../dto/codOrder.dto';
import { CodOrderService } from '../services/codOrder.service';

/**
 * HTTP entry point for COD order operations. Thin layer — all logic lives in
 * {@link CodOrderService}.
 */
export class CodOrderController {
  private readonly integrationEnabled = configService.get('CODAGENT').ENABLED;

  constructor(private readonly codOrderService: CodOrderService) {}

  public async createOrder(instance: InstanceDto, data: CreateCodOrderDto) {
    if (!this.integrationEnabled) {
      throw new BadRequestException('CodAgent is disabled');
    }
    return this.codOrderService.createOrder(instance, data);
  }
}

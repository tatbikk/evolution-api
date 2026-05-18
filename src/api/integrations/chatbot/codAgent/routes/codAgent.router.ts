import { RouterBroker } from '@api/abstract/abstract.router';
import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { HttpStatus } from '@api/routes/index.router';
import { codAgentController, codMerchantController, codOrderController } from '@api/server.module';
import {
  codAgentIgnoreJidSchema,
  codAgentSchema,
  codAgentSettingSchema,
  codAgentStatusSchema,
  codMerchantSchema,
  codOrderSchema,
  instanceSchema,
} from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { CodAgentDto, CodAgentSettingDto } from '../dto/codAgent.dto';
import { CodMerchantDto, CreateCodOrderDto } from '../dto/codOrder.dto';

export class CodAgentRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CodAgentDto>({
          request: req,
          schema: codAgentSchema,
          ClassRef: CodAgentDto,
          execute: (instance, data) => codAgentController.createBot(instance, data),
        });
        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codAgentController.findBot(instance),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetch/:codAgentId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codAgentController.fetchBot(instance, req.params.codAgentId),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .put(this.routerPath('update/:codAgentId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CodAgentDto>({
          request: req,
          schema: codAgentSchema,
          ClassRef: CodAgentDto,
          execute: (instance, data) => codAgentController.updateBot(instance, req.params.codAgentId, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete/:codAgentId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codAgentController.deleteBot(instance, req.params.codAgentId),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CodAgentSettingDto>({
          request: req,
          schema: codAgentSettingSchema,
          ClassRef: CodAgentSettingDto,
          execute: (instance, data) => codAgentController.settings(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codAgentController.fetchSettings(instance),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: codAgentStatusSchema,
          ClassRef: InstanceDto,
          execute: (instance, data) => codAgentController.changeStatus(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSessions/:codAgentId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codAgentController.fetchSessions(instance, req.params.codAgentId),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req, res) => {
        const response = await this.dataValidate<IgnoreJidDto>({
          request: req,
          schema: codAgentIgnoreJidSchema,
          ClassRef: IgnoreJidDto,
          execute: (instance, data) => codAgentController.ignoreJid(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('order'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CreateCodOrderDto>({
          request: req,
          schema: codOrderSchema,
          ClassRef: CreateCodOrderDto,
          execute: (instance, data) => codOrderController.createOrder(instance, data),
        });
        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('order/list'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codOrderController.listOrders(instance, req.query.status as string),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('order/fetch/:orderId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codOrderController.getOrder(instance, req.params.orderId),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('merchant'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => codMerchantController.getMerchant(instance),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('merchant'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CodMerchantDto>({
          request: req,
          schema: codMerchantSchema,
          ClassRef: CodMerchantDto,
          execute: (instance, data) => codMerchantController.setMerchant(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}

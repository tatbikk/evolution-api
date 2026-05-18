import { CodOrderStatus } from '../domain/orderState';

/**
 * Shape of a `cod_merchant` row — the per-instance COD business profile.
 */
export interface CodMerchant {
  id: string;
  instanceId: string;
  businessName?: string | null;
  escalationJid?: string | null;
  confirmationTemplate?: string | null;
  reminderTemplate?: string | null;
  reminderIntervalMinutes: number;
  maxReminders: number;
  noResponseAfterMinutes: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Shape of a `cod_order_item` row.
 */
export interface CodOrderItem {
  id: string;
  orderId: string;
  productName: string;
  quantity: number;
  unitPrice?: number | null;
  createdAt?: string;
}

/**
 * Shape of a `cod_order` row.
 */
export interface CodOrder {
  id: string;
  instanceId: string;
  merchantOrderRef: string;
  customerJid: string;
  customerName?: string | null;
  customerPhone?: string | null;
  status: CodOrderStatus;
  statusReason?: string | null;
  totalAmount?: number | null;
  currency?: string | null;
  deliveryAddress?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
  reminderCount: number;
  lastReminderAt?: string | null;
  confirmationSentAt?: string | null;
  sessionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Populated when the order is fetched with its items.
  items?: CodOrderItem[];
}

/**
 * Input accepted by the atomic `create_cod_order` Supabase function.
 */
export interface CreateCodOrderInput {
  instanceId: string;
  merchantOrderRef: string;
  customerJid: string;
  customerName?: string;
  customerPhone?: string;
  totalAmount?: number;
  currency?: string;
  deliveryAddress?: string;
  deliveryDate?: string;
  notes?: string;
}

export interface CreateCodOrderItemInput {
  productName: string;
  quantity?: number;
  unitPrice?: number;
}

/**
 * Request body for `POST /codAgent/merchant/:instanceName` — the per-instance
 * COD business profile. All fields are optional (partial upsert). The
 * escalation contact is given as a plain phone number; the service derives
 * the WhatsApp jid.
 */
export class CodMerchantDto {
  businessName?: string;
  escalationNumber?: string;
  confirmationTemplate?: string;
  reminderTemplate?: string;
  reminderIntervalMinutes?: number;
  maxReminders?: number;
  noResponseAfterMinutes?: number;
}

/**
 * Request body accepted by `POST /codAgent/order/:instanceName`.
 * The customer is identified by a plain phone number; the service derives
 * the WhatsApp jid. `instanceId` is never accepted from the client — it is
 * resolved from the authenticated instance.
 */
export class CreateCodOrderDto {
  merchantOrderRef: string;
  customerNumber: string;
  customerName?: string;
  totalAmount?: number;
  currency?: string;
  deliveryAddress?: string;
  deliveryDate?: string;
  notes?: string;
  items?: CreateCodOrderItemInput[];
}

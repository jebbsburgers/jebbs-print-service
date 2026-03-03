// =====================
// ORDER (orders table)
// =====================
export type OrderStatus = "new" | "ready" | "completed" | "canceled";

export interface Order {
  id: string;
  order_number: number;

  customer_id: string | null;
  customer_name: string;
  customer_address_id: string | null;

  payment_method: "cash" | "transfer";
  delivery_type: "delivery" | "pickup";
  delivery_time: string | null;
  delivery_fee: number;
  status: OrderStatus;

  // 🆕 Descuentos
  discount_type: "amount" | "percentage" | "none";
  discount_value: number;
  discount_amount: number;

  total_amount: number;
  notes: string | null;

  is_paid: boolean;

  created_at: string;
  updated_at: string;
}

// =====================
// ORDER ITEM
// =====================
export interface OrderItem {
  id: string;
  order_id: string;

  burger_id: string | null;
  combo_id: string | null;
  burger_name: string;

  quantity: number;
  unit_price: number;
  subtotal: number;

  customizations: string | null; // JSON string con detalles

  created_at: string;
}

// =====================
// ORDER ITEM EXTRA
// =====================
export interface OrderItemExtra {
  id: string;
  order_item_id: string;

  extra_id: string;
  extra_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;

  created_at: string;
}

// =====================
// CUSTOMER ADDRESS
// =====================
export interface CustomerAddress {
  id: string;
  customer_id: string;
  label: string;
  address: string;
  notes: string | null;
  is_default: boolean;
}

// =====================
// PARSED CUSTOMIZATIONS
// =====================
export interface BurgerCustomization {
  burgerId: string;
  name: string;
  meatCount: number;
  friesQuantity: number;
  quantity: number;
  removedIngredients: string[];
  extras: {
    id: string;
    name: string;
    quantity: number;
    price: number;
  }[];
}

export interface ComboCustomization {
  slotId: string;
  burgers: BurgerCustomization[];
}

// =====================
// ORDER ITEM EXTENDED
// =====================
export interface OrderItemWithExtras extends OrderItem {
  extras: OrderItemExtra[];
  parsedCustomizations?: BurgerCustomization[] | ComboCustomization[];
}

// =====================
// FULL ORDER (PRINT)
// =====================
export interface OrderWithItems extends Order {
  items: OrderItemWithExtras[];
  customerAddress?: CustomerAddress | null;
  customerPhone?: string | null;
}

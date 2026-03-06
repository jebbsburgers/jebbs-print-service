import { supabase } from "../supabase";
import type {
  OrderWithItems,
  OrderItemWithExtras,
  BurgerCustomization,
  ComboCustomization,
} from "../types/order";

function parseCustomizations(
  item: any,
): BurgerCustomization[] | ComboCustomization[] | undefined {
  if (!item.customizations) return undefined;

  if (item.combo_id) {
    try {
      const parsed = JSON.parse(item.customizations);
      return parsed as ComboCustomization[];
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export async function getOrderWithItems(
  orderId: string,
): Promise<OrderWithItems> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error("Order not found");
  }

  let customerAddress = null;
  if (order.customer_address_id) {
    const { data: address } = await supabase
      .from("customer_addresses")
      .select("*")
      .eq("id", order.customer_address_id)
      .single();

    customerAddress = address;
  }

  let customerPhone: string | null = null;
  if (order.customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("phone")
      .eq("id", order.customer_id)
      .single();

    customerPhone = customer?.phone ?? null;
  }

  // ✅ Incluir extra_id explícitamente para detectar sides correctamente
  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, burger_id, combo_id, extra_id, burger_name, quantity, unit_price, subtotal, customizations, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (itemsError) {
    throw new Error("Order items not found");
  }

  const itemsWithExtras: OrderItemWithExtras[] = await Promise.all(
    items.map(async (item) => {
      const { data: extras } = await supabase
        .from("order_item_extras")
        .select("*")
        .eq("order_item_id", item.id);

      const parsedCustomizations = parseCustomizations(item);

      return {
        ...item,
        extras: extras || [],
        parsedCustomizations,
      };
    }),
  );

  return {
    ...order,
    items: itemsWithExtras,
    customerAddress,
    customerPhone,
  };
}
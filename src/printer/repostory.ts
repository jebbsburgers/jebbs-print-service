import { supabase } from "../supabase";
import type {
  OrderWithItems,
  OrderItemWithExtras,
  BurgerCustomization,
  ComboCustomization,
} from "../types/order";

/**
 * Parsea las customizaciones de un item
 * - Si es combo: JSON con slots y burgers
 * - Si es burger individual: String con ingredientes removidos
 */
function parseCustomizations(
  item: any,
): BurgerCustomization[] | ComboCustomization[] | undefined {
  if (!item.customizations) return undefined;

  // Si es combo (tiene combo_id)
  if (item.combo_id) {
    try {
      const parsed = JSON.parse(item.customizations);
      return parsed as ComboCustomization[];
    } catch {
      return undefined;
    }
  }

  // Si es burger individual, no hay mucho que parsear
  // (solo tiene string de ingredientes removidos)
  return undefined;
}

export async function getOrderWithItems(
  orderId: string,
): Promise<OrderWithItems> {
  // 1. Traer orden
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error("Order not found");
  }

  // 2. Traer dirección del cliente (si tiene)
  let customerAddress = null;
  if (order.customer_address_id) {
    const { data: address } = await supabase
      .from("customer_addresses")
      .select("*")
      .eq("id", order.customer_address_id)
      .single();

    customerAddress = address;
  }

  // 2.5 🆕 Traer teléfono del cliente (si tiene customer_id)
  let customerPhone: string | null = null;
  if (order.customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("phone")
      .eq("id", order.customer_id)
      .single();

    customerPhone = customer?.phone ?? null;
  }

  // 3. Traer items de la orden
  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (itemsError) {
    throw new Error("Order items not found");
  }

  // 4. Traer extras de cada item
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
    customerPhone, // 🆕
  };
}

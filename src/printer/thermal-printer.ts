import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import { OrderWithItems } from "../types/order";
import {
  translateDeliveryType,
  translatePaymentMethod,
} from "../utils/translate";

const execAsync = promisify(exec);

// Configuración de la impresora
const PRINTER_NAME = "POS-80-Series";

// Ancho del papel térmico (caracteres)
const PAPER_WIDTH = 42;

// Helper para calcular sizeLabel
function getSizeLabel(meatCount: number): string {
  switch (meatCount) {
    case 1:
      return "Simple";
    case 2:
      return "Doble";
    case 3:
      return "Triple";
    case 4:
      return "Cuadruple";
    case 5:
      return "Quintuple";
    default:
      return `${meatCount} carnes`;
  }
}

function getFriesLabel(friesQuantity: number, friesAdjustment: number): string {
  if (friesQuantity === 0) {
    const discount = Math.abs(friesAdjustment ?? 0);
    return discount > 0 ? `Sin papas (-$${discount.toLocaleString("es-AR")})` : "Sin papas";
  }
  const label = friesQuantity === 1 ? "1 porción de papas" : `${friesQuantity} porciones de papas`;
  return (friesAdjustment ?? 0) > 0 ? `${label} (+$${friesAdjustment.toLocaleString("es-AR")})` : label;
}


export async function printOrderWithThermal(
  order: OrderWithItems,
): Promise<void> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: "tcp://localhost",
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    lineCharacter: "=",
    width: PAPER_WIDTH,
    options: {
      timeout: 5000,
    },
  });

  try {
    console.log("📋 Preparando ticket...");

    printer.newLine();
    printer.newLine();

    // ===== HORARIO DE ENTREGA/RETIRO (ARRIBA A LA IZQUIERDA) =====
    if (order.delivery_time) {
      printer.alignCenter();
      printer.bold(true);
      printer.setTextSize(1, 0);

      if (order.delivery_type === "delivery") {
        printer.println(`ENTREGAR: ${order.delivery_time}`);
      } else {
        printer.println(`RETIRO: ${order.delivery_time}`);
      }

      printer.setTextSize(0, 0);
      printer.bold(false);
      printer.newLine();
    }

    // ===== LOGO SUPERIOR =====
    const logoPath = path.join(__dirname, "..", "..", "assets", "logo.png");

    if (fs.existsSync(logoPath)) {
      try {
        printer.alignCenter();
        await printer.printImage(logoPath);
        printer.newLine();
        printer.newLine();
        console.log("✅ Logo cargado");
      } catch (logoError: any) {
        console.warn("⚠️ Logo falló:", logoError.message);
      }
    }

    printer.newLine();

    // ===== HEADER =====
    printer.alignCenter();
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println("JEBBS BURGERS");
    printer.bold(false);

    printer.bold(true);
    printer.setTextSize(2, 2);
    if (order.order_number >= 100) {
      printer.println("PEDIDO");
      printer.println(`#${order.order_number}`);
    } else {
      printer.println(`PEDIDO #${order.order_number}`);
    }
    printer.setTextSize(0, 0);
    printer.bold(false);

    printer.println(
      new Date(order.created_at).toLocaleString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    printer.drawLine();
    printer.newLine();

    // ===== CLIENTE =====
    printer.alignLeft();
    printer.bold(true);
    printer.setTextSize(0, 1);
    printer.println("CLIENTE");
    printer.setTextSize(0, 0);
    printer.bold(false);
    printer.newLine();

    printer.setTextSize(0, 1);
    const phoneLabel = order.customerPhone ? `   Tel: ${order.customerPhone}` : "";
    printer.println(`Nombre: ${order.customer_name}${phoneLabel}`);
    printer.setTextSize(0, 0);
    printer.newLine();

    if (order.customerAddress) {
      printer.println(
        `Dirección: ${order.customerAddress.label} - ${order.customerAddress.address}`,
      );
      if (order.customerAddress.notes) {
        printer.println(`  ${order.customerAddress.notes}`);
      }
    }

    printer.newLine();
    printer.drawLine();
    printer.newLine();

    // ===== DETALLE DEL PEDIDO =====
    printer.alignLeft();
    printer.bold(true);
    printer.setTextSize(0, 1);
    printer.println("DETALLE");
    printer.setTextSize(0, 0);
    printer.bold(false);
    printer.newLine();

    for (const item of order.items) {
      const itemBasePrice = item.unit_price * item.quantity;
      const extrasTotal = item.extras.reduce((sum, e) => sum + e.subtotal, 0);

      let customData: any = null;
      let isCombo = false;

      // ===== DETECTAR SIDE =====
      // Los sides tienen customizations null y pueden tener extra_id
      const isSide = !item.burger_id && !item.combo_id && !item.customizations;

      if (item.customizations) {
        try {
          customData = JSON.parse(item.customizations);
          isCombo = Array.isArray(customData);
        } catch {
          // No es JSON
        }
      }

      // ===== HEADER DEL ITEM =====
      printer.setTextSize(0, 1);
      printer.bold(true);

      if (!isCombo && !isSide && customData?.meatCount) {
        const veggieTag = customData.isVeggie ? " [VEGGIE]" : "";
        const sinPapas = customData.friesQuantity === 0;
        const baseText = `${item.quantity}x ${item.burger_name} x${customData.meatCount}${veggieTag}`;

        if (sinPapas) {
          const discount = Math.abs(customData.friesAdjustment ?? 0);
          const sinLabel = discount > 0 ? ` Sin papas (-$${discount.toLocaleString("es-AR")}) ` : " Sin papas ";
          printer.print(`${baseText} - `);
          printer.invert(true);
          printer.print(sinLabel);
          printer.invert(false);
          printer.println("");
        } else {
          const friesLabel = customData.friesQuantity !== undefined
            ? ` - ${getFriesLabel(customData.friesQuantity, customData.friesAdjustment ?? 0)}`
            : "";
          printer.println(`${baseText}${friesLabel}`);
        }
      } else {
        printer.println(`${item.quantity}x ${item.burger_name}`);
      }

      printer.bold(false);
      printer.setTextSize(0, 0);

      // ===== PRECIO BASE =====
      printer.newLine();
      printer.println(`Base: $${itemBasePrice.toLocaleString("es-AR")}`);

      // ===== DESGLOSE =====
      if (isSide) {
        // ===== SIDE / ACOMPAÑAMIENTO =====
        if (item.extras.length > 0) {
          printer.newLine();
          item.extras.forEach((extra) => {
            printer.println(`+${extra.quantity}x ${extra.extra_name} - +$${extra.subtotal.toLocaleString("es-AR")}`);
          });
        }
      } else if (item.customizations) {
        if (!isCombo && customData) {
          // ===== BURGER INDIVIDUAL =====
          printer.newLine();

          if (customData.removedIngredients?.length > 0) {
            printer.setTextSize(0, 1);
            printer.bold(true);
            printer.invert(true);
            printer.println(` Sin: ${customData.removedIngredients.join(", ")} `);
            printer.invert(false);
            printer.bold(false);
            printer.setTextSize(0, 0);
          }

          const visibleExtras = (customData.extras ?? []).filter((extra: any) => {
            const isFriesType = extra.price === 0 && extra.name.toLowerCase().includes("papas");
            return !(isFriesType && (customData.friesQuantity ?? 0) > 0);
          });

          if (visibleExtras.length > 0) {
            printer.newLine();
            visibleExtras.forEach((extra: any) => {
              const extraPrice = extra.price * extra.quantity;
              printer.println(`+${extra.quantity}x ${extra.name} - +$${extraPrice.toLocaleString("es-AR")}`);
            });
          }
        } else if (isCombo && Array.isArray(customData)) {
          // ===== COMBO =====
          printer.newLine();

          customData.forEach((slot: any, slotIndex: number) => {
            // 🍔 BURGERS
            if (slot.burgers && slot.burgers.length > 0) {
              if (slotIndex > 0) printer.newLine();

              slot.burgers.forEach((burger: any) => {
                const veggieTag = burger.isVeggie ? " [VEGGIE]" : "";
                const sinPapas = burger.friesQuantity === 0;
                const baseText = `${burger.quantity}x ${burger.name} x${burger.meatCount}${veggieTag}`;
                printer.setTextSize(0, 1);

                if (sinPapas) {
                  const discount = Math.abs(burger.friesAdjustment ?? 0);
                  const sinLabel = discount > 0 ? ` Sin papas (-$${discount.toLocaleString("es-AR")}) ` : " Sin papas ";
                  printer.print(`${baseText} - `);
                  printer.invert(true);
                  printer.print(sinLabel);
                  printer.invert(false);
                  printer.println("");
                } else {
                  const friesLabel = burger.friesQuantity !== undefined
                    ? ` - ${getFriesLabel(burger.friesQuantity, burger.friesAdjustment ?? 0)}`
                    : "";
                  printer.println(`${baseText}${friesLabel}`);
                }

                printer.setTextSize(0, 0);

                if (burger.removedIngredients?.length > 0) {
                  printer.setTextSize(0, 1);
                  printer.bold(true);
                  printer.invert(true);
                  printer.println(
                    ` Sin: ${burger.removedIngredients.join(", ")} `,
                  );
                  printer.invert(false);
                  printer.bold(false);
                  printer.setTextSize(0, 0);
                }

                if (burger.extras?.length > 0) {
                  printer.newLine();
                  burger.extras.forEach((extra: any) => {
                    const extraPrice = extra.price * extra.quantity;
                    printer.println(`  +${extra.quantity}x ${extra.name} - +$${extraPrice.toLocaleString("es-AR")}`);
                  });
                }
              });
            }

            // 🥤 BEBIDAS Y NUGGETS
            const slotExtras = slot.selectedExtras ?? (slot.selectedExtra ? [slot.selectedExtra] : []);
            if (slotExtras.length > 0) {
              if (slotIndex > 0 || slot.burgers?.length > 0) {
                printer.newLine();
              }

              slotExtras.forEach((selectedExtra: any) => {
                printer.setTextSize(0, 1);
                const extraPriceLabel = selectedExtra.price > 0
                  ? ` - +$${selectedExtra.price.toLocaleString("es-AR")}`
                  : "";
                if (slot.slotType === "drink") {
                  printer.println(`Bebida: ${selectedExtra.name}${extraPriceLabel}`);
                } else {
                  printer.println(`${selectedExtra.name}${extraPriceLabel}`);
                }
                printer.setTextSize(0, 0);
              });
            }
          });
        } else if (typeof item.customizations === "string") {
          printer.println(item.customizations);
        }
      }

      // ===== SUBTOTAL =====
      if (isCombo || isSide || extrasTotal > 0) {
        const totalWithExtras = item.subtotal + extrasTotal;
        printer.newLine();
        printer.println(
          `Subtotal: $${totalWithExtras.toLocaleString("es-AR")}`,
        );
      }

      printer.newLine();
      printer.drawLine();
      printer.newLine();
    }

    // ===== TOTALES =====
    printer.setTextSize(0, 0);

    const subtotal =
      order.total_amount + order.discount_amount - order.delivery_fee;

    if (order.discount_amount > 0) {
      printer.tableCustom([
        { text: "Subtotal", align: "LEFT", width: 0.5 },
        {
          text: `$${subtotal.toLocaleString("es-AR")}`,
          align: "RIGHT",
          width: 0.5,
        },
      ]);

      const discountLabel =
        order.discount_type === "percentage"
          ? `Desc (${order.discount_value}%)`
          : "Descuento";

      printer.tableCustom([
        { text: discountLabel, align: "LEFT", width: 0.5 },
        {
          text: `-$${order.discount_amount.toLocaleString("es-AR")}`,
          align: "RIGHT",
          width: 0.5,
        },
      ]);
    }

    if (order.delivery_fee > 0) {
      printer.setTextSize(0, 1);
      printer.tableCustom([
        { text: "Envio", align: "LEFT", width: 0.5 },
        {
          text: `$${order.delivery_fee.toLocaleString("es-AR")}`,
          align: "RIGHT",
          width: 0.5,
        },
      ]);
      printer.setTextSize(0, 0);
    }

    printer.drawLine();

    // Total
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.tableCustom([
      { text: "TOTAL", align: "LEFT", width: 0.5 },
      {
        text: `$${order.total_amount.toLocaleString("es-AR")}`,
        align: "RIGHT",
        width: 0.5,
      },
    ]);
    printer.setTextSize(0, 0);
    printer.bold(false);

    printer.drawLine();
    printer.newLine();
    printer.newLine();

    // ===== RESUMEN COCINA =====
    printer.alignLeft();
    printer.bold(true);
    printer.setTextSize(0, 1);
    printer.println("RESUMEN");
    printer.setTextSize(0, 0);
    printer.bold(false);
    printer.newLine();

    // Contar medallones
    let totalMeat = 0;
    let totalVeggieMeat = 0;
    // Contar papas de burgers (friesQuantity en customizations)
    let totalFries = 0;
    // Contar extras (papas grandes, bebidas, etc.) con un mapa
    const extrasSummary: Record<string, number> = {};
    // Contar bebidas de combos
    const drinksSummary: Record<string, number> = {};

    for (const item of order.items) {
      if (item.customizations) {
        try {
          const customData = JSON.parse(item.customizations);

          if (Array.isArray(customData)) {
            customData.forEach((slot: any) => {
              slot.burgers?.forEach((burger: any) => {
                const meatQty = (burger.meatCount ?? 1) * (burger.quantity ?? 1) * item.quantity;
                if (burger.isVeggie) {
                  totalVeggieMeat += meatQty;
                } else {
                  totalMeat += meatQty;
                }

                if (burger.friesQuantity !== undefined) {
                  totalFries += burger.friesQuantity * (burger.quantity ?? 1) * item.quantity;
                }
              });

              // Bebidas y sides del combo
              const slotSelectedExtras = slot.selectedExtras ?? (slot.selectedExtra ? [slot.selectedExtra] : []);
              if (slot.slotType === "drink") {
                slotSelectedExtras.forEach((drink: any) => {
                  drinksSummary[drink.name] = (drinksSummary[drink.name] ?? 0) + item.quantity;
                });
              } else if (slot.slotType === "side") {
                slotSelectedExtras.forEach((side: any) => {
                  extrasSummary[side.name] = (extrasSummary[side.name] ?? 0) + item.quantity;
                });
              }
            });
          } else {
            const meatQty = (customData.meatCount ?? 1) * item.quantity;
            if (customData.isVeggie) {
              totalVeggieMeat += meatQty;
            } else {
              totalMeat += meatQty;
            }

            if (customData.friesQuantity !== undefined) {
              const hasSpecialFries = item.extras.some(e =>
                e.extra_name.toLowerCase().includes("papas")
              );
              if (!hasSpecialFries) {
                totalFries += customData.friesQuantity * item.quantity;
              }
            }
          }
        } catch {}
      } else if (item.burger_id && !item.combo_id) {
        // Burger sin customizations: asumir regular
        totalMeat += item.quantity;
      }

      // 🟢 Detectar acompañamientos standalone (tienen extra_id)
      if (item.extra_id) {
        const key = item.burger_name;
        extrasSummary[key] = (extrasSummary[key] ?? 0) + item.quantity;
      }

      // Extras dentro de hamburguesas - todos al resumen
      for (const extra of item.extras) {
        const key = extra.extra_name;
        extrasSummary[key] = (extrasSummary[key] ?? 0) + extra.quantity;
      }
    }

    if (totalMeat > 0) {
      printer.setTextSize(0, 1);
      printer.bold(true);
      printer.print(`${totalMeat}`);
      printer.bold(false);
      printer.println(`  Medallones`);
      printer.setTextSize(0, 0);
    }
    if (totalVeggieMeat > 0) {
      printer.setTextSize(0, 1);
      printer.bold(true);
      printer.print(`${totalVeggieMeat}`);
      printer.bold(false);
      printer.println(`  Medallones Veggie`);
      printer.setTextSize(0, 0);
    }
    if (totalFries > 0) {
      printer.setTextSize(0, 1);
      printer.bold(true);
      printer.print(`${totalFries}`);
      printer.bold(false);
      printer.println(`  Papas`);
      printer.setTextSize(0, 0);
    }
    for (const [name, qty] of Object.entries(drinksSummary)) {
      printer.setTextSize(0, 1);
      printer.bold(true);
      printer.print(`${qty}`);
      printer.bold(false);
      printer.println(`  ${name}`);
      printer.setTextSize(0, 0);
    }
    for (const [name, qty] of Object.entries(extrasSummary)) {
      let displayName = name;

      if (displayName.toLowerCase().includes("papas con bacon y cheddar")) {
        displayName = displayName
          .replace(/chicas/i, "CH")
          .replace(/grandes/i, "GR");
      }

      printer.setTextSize(0, 1);
      printer.bold(true);
      printer.print(`${qty}`);
      printer.bold(false);
      printer.println(`  ${displayName}`);
      printer.setTextSize(0, 0);
    }

    printer.newLine();
    printer.drawLine();
    printer.newLine();

    // ===== ENTREGA Y PAGO =====
    printer.setTextSize(0, 1);
    printer.println(
      `Entrega: ${translateDeliveryType(order.delivery_type) || "N/A"}  |  Pago: ${translatePaymentMethod(order.payment_method) || "N/A"}`,
    );
    printer.setTextSize(0, 0);

    // Notas
    if (order.notes) {
      printer.newLine();
      printer.drawLine();
      printer.bold(true);
      printer.println("NOTAS");
      printer.bold(false);
      printer.println(order.notes);
    }

    printer.newLine();
    printer.alignCenter();
    printer.setTextSize(0, 1);
    printer.println("Gracias por elegirnos!");
    printer.setTextSize(0, 0);

    printer.cut();

    console.log("🖨️ Generando buffer...");
    const buffer = await printer.getBuffer();
    console.log("📝 Buffer size:", buffer.length, "bytes");

    const ticketPath = path.join(process.cwd(), "temp-ticket.prn");
    fs.writeFileSync(ticketPath, buffer, { encoding: "binary" });

    console.log("🖨️ Enviando a:", PRINTER_NAME);
    const cmd = `copy /b "${ticketPath}" "\\\\localhost\\${PRINTER_NAME}"`;
    const result = await execAsync(cmd);

    console.log("📄", result.stdout || "OK");
    fs.unlinkSync(ticketPath);

    console.log("✅ Impreso!");
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
}

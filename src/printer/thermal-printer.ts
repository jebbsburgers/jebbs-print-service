import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
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
const PRINTER_NAME = "POS-58";

// Ancho del papel térmico (caracteres)
const PAPER_WIDTH = 32;

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

// Helper para imprimir línea de papas con ajuste de precio
function printFriesLine(
  printer: ThermalPrinter,
  friesQuantity: number,
  friesAdjustment: number,
  indent: string = "",
) {
  if (friesQuantity === 0) {
    const discount = Math.abs(friesAdjustment ?? 0);
    printer.println(
      discount > 0
        ? `${indent}Sin papas  -$${discount.toLocaleString("es-AR")}`
        : `${indent}Sin papas`,
    );
  } else if ((friesAdjustment ?? 0) > 0) {
    printer.println(
      `${indent}${friesQuantity} papas  +$${friesAdjustment.toLocaleString("es-AR")}`,
    );
  } else {
    printer.println(`${indent}${friesQuantity} papas`);
  }
}

export async function printOrderWithThermal(
  order: OrderWithItems,
): Promise<void> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: "tcp://localhost",
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
      printer.alignLeft();
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
    printer.println(`PEDIDO #${order.order_number}`);
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

    printer.println(order.customer_name);
    printer.newLine();

    if (order.customerPhone) {
      printer.println(`Tel: ${order.customerPhone}`);
    }

    if (order.customerAddress) {
      printer.newLine();
      printer.println(
        `${order.customerAddress.label} - ${order.customerAddress.address}`,
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
      printer.bold(true);

      if (!isCombo && !isSide && customData?.meatCount) {
        printer.println(
          `${item.quantity}x ${item.burger_name} x${customData.meatCount}`,
        );
      } else {
        printer.println(`${item.quantity}x ${item.burger_name}`);
      }

      printer.bold(false);

      // ===== PRECIO BASE =====
      printer.println(`Base: $${itemBasePrice.toLocaleString("es-AR")}`);

      // ===== DESGLOSE =====
      if (isSide) {
        // ===== SIDE / ACOMPAÑAMIENTO =====
        if (item.extras.length > 0) {
          printer.newLine();
          item.extras.forEach((extra) => {
            printer.println(`+${extra.quantity}x ${extra.extra_name}`);
            printer.println(`  +$${extra.subtotal.toLocaleString("es-AR")}`);
          });
        }
      } else if (item.customizations) {
        if (!isCombo && customData) {
          // ===== BURGER INDIVIDUAL =====
          printer.newLine();

          if (customData.removedIngredients?.length > 0) {
            printer.println(`Sin: ${customData.removedIngredients.join(", ")}`);
          }

          if (customData.friesQuantity !== undefined) {
            printFriesLine(
              printer,
              customData.friesQuantity,
              customData.friesAdjustment ?? 0,
            );
          }

          if (customData.extras?.length > 0) {
            printer.newLine();
            customData.extras.forEach((extra: any) => {
              const extraPrice = extra.price * extra.quantity;
              printer.println(`+${extra.quantity}x ${extra.name}`);
              printer.println(`  +$${extraPrice.toLocaleString("es-AR")}`);
              printer.newLine();
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
                printer.println(
                  `${burger.quantity}x ${burger.name} x${burger.meatCount}`,
                );

                printer.newLine();

                if (burger.removedIngredients?.length > 0) {
                  printer.println(
                    `  Sin: ${burger.removedIngredients.join(", ")}`,
                  );
                }

                if (burger.friesQuantity !== undefined) {
                  printFriesLine(
                    printer,
                    burger.friesQuantity,
                    burger.friesAdjustment ?? 0,
                  );
                  if (
                    (burger.friesAdjustment ?? 0) === 0 &&
                    burger.friesQuantity > 0
                  ) {
                    printer.newLine();
                  }
                }

                if (burger.extras?.length > 0) {
                  printer.newLine();
                  burger.extras.forEach((extra: any) => {
                    const extraPrice = extra.price * extra.quantity;
                    printer.println(`  +${extra.quantity}x ${extra.name}`);
                    printer.println(
                      `    +$${extraPrice.toLocaleString("es-AR")}`,
                    );
                    printer.newLine();
                  });
                }
              });
            }

            // 🥤 BEBIDAS Y NUGGETS
            if (slot.selectedExtra) {
              if (slotIndex > 0 || slot.burgers?.length > 0) {
                printer.newLine();
              }

              if (slot.slotType === "drink") {
                printer.println(`Bebida: ${slot.selectedExtra.name}`);
              } else {
                printer.println(slot.selectedExtra.name);
              }

              if (slot.selectedExtra.price > 0) {
                printer.println(
                  `  +$${slot.selectedExtra.price.toLocaleString("es-AR")}`,
                );
              }
            }
          });
        } else if (typeof item.customizations === "string") {
          printer.println(item.customizations);
        }
      }

      // ===== SUBTOTAL =====
      if (isCombo || isSide || extrasTotal > 0) {
        const totalWithExtras = item.subtotal + extrasTotal;
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
      printer.tableCustom([
        { text: "Envio", align: "LEFT", width: 0.5 },
        {
          text: `$${order.delivery_fee.toLocaleString("es-AR")}`,
          align: "RIGHT",
          width: 0.5,
        },
      ]);
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

    // ===== ENTREGA Y PAGO =====
    printer.bold(true);
    printer.println("ENTREGA");
    printer.bold(false);
    printer.println(translateDeliveryType(order.delivery_type) || "N/A");
    printer.newLine();

    printer.bold(true);
    printer.println("PAGO");
    printer.bold(false);
    printer.println(translatePaymentMethod(order.payment_method) || "N/A");

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
    printer.println("Gracias por elegirnos!");

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
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { formatOrder } from "./formatter";
import { OrderWithItems } from "../types/order";

const PRINTER_NAME = "POS-58";

export function printOrder(order: OrderWithItems): Promise<void> {
  return new Promise((resolve, reject) => {
    const ticket = formatOrder(order);

    const filePath = path.join(process.cwd(), "ticket.txt");

    fs.writeFileSync(filePath, ticket, "ascii");

    const cmd = `cmd /c copy /b "${filePath}" "\\\\localhost\\${PRINTER_NAME}"`;

    exec(cmd, (error) => {
      if (error) {
        console.error("PRINT ERROR", error);
        reject(error);
      } else {
        console.log("🖨 Ticket impreso");
        resolve();
      }
    });
  });
}

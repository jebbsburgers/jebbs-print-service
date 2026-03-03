import { Router } from "express";
import { getOrderWithItems } from "../printer/repostory";
import { printOrderWithThermal } from "../printer/thermal-printer";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    const order = await getOrderWithItems(orderId);


    console.log(JSON.stringify(order, null, 2));

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    await printOrderWithThermal(order);

    res.json({ message: "Print success" });
  } catch (error) {
    console.error("PRINT ERROR", error);
    res.status(500).json({ error: "Print failed" });
  }
});

export default router;

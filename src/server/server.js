import express from "express";
import { useProjectRoot } from "../project-root.js";
import noticeRoutes from "./routes/notice-routes.js";
import scanRoutes from "./routes/scan-routes.js";

useProjectRoot();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    name: "PhilGEPS Automation",
  });
});

app.use("/api/notices", noticeRoutes);
app.use("/api/scan", scanRoutes);

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`PhilGEPS server running at http://localhost:${PORT}`);
});
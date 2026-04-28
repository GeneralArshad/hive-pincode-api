// ============================================================
// Hive Frontline — Pincode Request API
// Stack: Node.js + Express + MongoDB Atlas
// ============================================================

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ---- MongoDB Connection ----
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ---- Schema: Pincode Request ----
const pincodeRequestSchema = new mongoose.Schema({
  pincode: { type: String, required: true, trim: true },
  areaName: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  mrName: { type: String, required: true, trim: true },
  mrEmployeeId: { type: String, required: true, trim: true },
  mrTerritory: { type: String, required: true, trim: true },
  reason: { type: String, trim: true, default: "" },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  adminNote: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Index for fast duplicate lookups
pincodeRequestSchema.index({ pincode: 1, mrEmployeeId: 1 });

const PincodeRequest = mongoose.model("PincodeRequest", pincodeRequestSchema);

// ---- Email Notification ----
async function sendNotification(request) {
  // Only send if email credentials are configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("📧 Email not configured — skipping notification");
    console.log("   New request:", request.pincode, "-", request.areaName, "by", request.mrName);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "smtp.office365.com",
      port: parseInt(process.env.EMAIL_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.NOTIFY_EMAIL || "arshad@britishbiologicals.com",
      subject: `🆕 New Pincode Request: ${request.pincode} — ${request.areaName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <div style="background:#0A1B3F;color:#fff;padding:20px 24px">
            <h2 style="margin:0;font-size:18px">Hive Frontline — New Pincode Request</h2>
          </div>
          <div style="padding:24px">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:8px 0;color:#6b7280;width:140px">Pincode</td><td style="padding:8px 0;font-weight:600">${request.pincode}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Area Name</td><td style="padding:8px 0;font-weight:600">${request.areaName}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">State</td><td style="padding:8px 0">${request.state}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Requested By</td><td style="padding:8px 0;font-weight:600">${request.mrName}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Employee ID</td><td style="padding:8px 0">${request.mrEmployeeId}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Territory</td><td style="padding:8px 0">${request.mrTerritory}</td></tr>
              ${request.reason ? `<tr><td style="padding:8px 0;color:#6b7280">Reason</td><td style="padding:8px 0">${request.reason}</td></tr>` : ""}
              <tr><td style="padding:8px 0;color:#6b7280">Submitted</td><td style="padding:8px 0">${new Date(request.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td></tr>
            </table>
          </div>
          <div style="background:#f7f9fa;padding:16px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">
            Hive Frontline Pincode Portal · British Biologicals Pvt. Ltd.
          </div>
        </div>
      `,
    });
    console.log("📧 Notification sent for pincode:", request.pincode);
  } catch (err) {
    console.error("📧 Email error:", err.message);
  }
}

// ============================================================
// API ROUTES
// ============================================================

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Hive Frontline Pincode API" });
});

// POST /api/pincode-requests — Submit a new pincode request
app.post("/api/pincode-requests", async (req, res) => {
  try {
    const { pincode, areaName, state, mrName, mrEmployeeId, mrTerritory, reason } = req.body;

    // Validate required fields
    if (!pincode || !areaName || !state || !mrName || !mrEmployeeId || !mrTerritory) {
      return res.status(400).json({
        success: false,
        message: "All fields are required (pincode, areaName, state, mrName, mrEmployeeId, mrTerritory)",
      });
    }

    // Validate pincode format (6 digits for India)
    if (!/^\d{6}$/.test(pincode.trim())) {
      return res.status(400).json({
        success: false,
        message: "Invalid pincode. Must be exactly 6 digits.",
      });
    }

    // Check for duplicate: same pincode already requested by same MR
    const existingForMR = await PincodeRequest.findOne({
      pincode: pincode.trim(),
      mrEmployeeId: mrEmployeeId.trim(),
    });

    if (existingForMR) {
      return res.status(409).json({
        success: false,
        message: `You have already requested pincode ${pincode}. Current status: ${existingForMR.status}.`,
        existingRequest: {
          id: existingForMR._id,
          status: existingForMR.status,
          createdAt: existingForMR.createdAt,
        },
      });
    }

    // Check if pincode was already requested by another MR (info only, still allow)
    const existingGlobal = await PincodeRequest.findOne({
      pincode: pincode.trim(),
      status: { $in: ["pending", "approved"] },
    });

    // Create the request
    const newRequest = new PincodeRequest({
      pincode: pincode.trim(),
      areaName: areaName.trim(),
      state: state.trim(),
      mrName: mrName.trim(),
      mrEmployeeId: mrEmployeeId.trim(),
      mrTerritory: mrTerritory.trim(),
      reason: (reason || "").trim(),
    });

    await newRequest.save();

    // Send email notification (async, don't block response)
    sendNotification(newRequest);

    return res.status(201).json({
      success: true,
      message: existingGlobal
        ? `Request submitted. Note: Pincode ${pincode} was also requested by another MR.`
        : `Pincode ${pincode} request submitted successfully.`,
      request: {
        id: newRequest._id,
        pincode: newRequest.pincode,
        areaName: newRequest.areaName,
        status: newRequest.status,
        createdAt: newRequest.createdAt,
      },
    });
  } catch (err) {
    console.error("Error creating request:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

// GET /api/pincode-requests — List all requests (admin view)
app.get("/api/pincode-requests", async (req, res) => {
  try {
    const { status, mrEmployeeId, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (mrEmployeeId) filter.mrEmployeeId = mrEmployeeId;

    const total = await PincodeRequest.countDocuments(filter);
    const requests = await PincodeRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    return res.json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      requests,
    });
  } catch (err) {
    console.error("Error fetching requests:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/pincode-requests/check/:pincode/:mrEmployeeId — Quick duplicate check
app.get("/api/pincode-requests/check/:pincode/:mrEmployeeId", async (req, res) => {
  try {
    const { pincode, mrEmployeeId } = req.params;
    const existing = await PincodeRequest.findOne({
      pincode: pincode.trim(),
      mrEmployeeId: mrEmployeeId.trim(),
    });

    return res.json({
      success: true,
      exists: !!existing,
      request: existing
        ? { id: existing._id, status: existing.status, createdAt: existing.createdAt }
        : null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/pincode-requests/:id — Update status (admin: approve/reject)
app.patch("/api/pincode-requests/:id", async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be approved, rejected, or pending." });
    }

    const updated = await PincodeRequest.findByIdAndUpdate(
      req.params.id,
      { status, adminNote: adminNote || "", updatedAt: Date.now() },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }

    return res.json({ success: true, request: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/stats — Dashboard stats
app.get("/api/stats", async (req, res) => {
  try {
    const [total, pending, approved, rejected] = await Promise.all([
      PincodeRequest.countDocuments(),
      PincodeRequest.countDocuments({ status: "pending" }),
      PincodeRequest.countDocuments({ status: "approved" }),
      PincodeRequest.countDocuments({ status: "rejected" }),
    ]);

    return res.json({ success: true, stats: { total, pending, approved, rejected } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

// ---- Start Server ----
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Pincode API running on port ${PORT}`);
});

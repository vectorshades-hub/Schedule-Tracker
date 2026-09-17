const express = require("express");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const path = require("path");
const env = require("./config/env");
const requestLogger = require("./middleware/requestLogger");

const authRoutes = require("./routes/auth");
const recordsRoutes = require("./routes/records");
const holdRoutes = require("./routes/hold");
const usersRoutes = require("./routes/users");
const activityLogRoutes = require("./routes/activityLog");
const notificationsRoutes = require("./routes/notifications");
const requestLogRoutes = require("./routes/requestLog");
const completedLogRoutes = require("./routes/completedLog");
const editingLogRoutes = require("./routes/editingLog");
const projectsRoutes = require("./routes/projects");
const reportsRoutes = require("./routes/reports");
const dailyPopupRoutes = require("./routes/dailyPopup");
const bulkUploadRoutes = require("./routes/bulkUpload");
const settingsRoutes = require("./routes/settings");
const changeOrdersRoutes = require("./routes/changeOrders");
const rfisRoutes = require("./routes/rfis");
const managementDashboardRoutes = require("./routes/managementDashboard");
const financeDashboardRoutes = require("./routes/financeDashboard");

const app = express();

app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  session({
    name: "st.sid",
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: env.mongoUri, collectionName: "sessions" }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true when served over HTTPS behind a proxy
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days — matches Flask's PERMANENT_SESSION_LIFETIME
    },
  })
);

app.use(requestLogger);

// Static download: the SDS2/Tekla macro script linked from the Editing Log page.
app.use("/static", express.static(path.join(__dirname, "..", "static")));

app.use("/api/auth", authRoutes);
app.use("/api/records", recordsRoutes);
app.use("/api/hold", holdRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/activity-log", activityLogRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/request-log", requestLogRoutes);
app.use("/api/completed-log", completedLogRoutes);
app.use("/api/editing-log", editingLogRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/daily-popup", dailyPopupRoutes);
app.use("/api/bulk-upload", bulkUploadRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/change-orders", changeOrdersRoutes);
app.use("/api/rfis", rfisRoutes);
app.use("/api/management-dashboard", managementDashboardRoutes);
app.use("/api/finance-dashboard", financeDashboardRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[UNHANDLED ERROR]", err);
  res.status(500).json({ ok: false, error: err.message || "Internal server error" });
});

module.exports = app;

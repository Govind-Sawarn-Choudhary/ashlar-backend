const asyncHandler = require('../utils/asyncHandler');
const walletService = require('../services/wallet.service');
const appointmentService = require('../services/appointment.service');
const notificationService = require('../services/notification.service');

const getDashboardStats = asyncHandler(async (req, res) => {
  const lawyerId = req.auth.sub;
  notificationService.seedWelcomeNotification(lawyerId, 'lawyer');

  const stats = appointmentService.getLawyerDashboardStats(lawyerId);
  const wallet = walletService.getWalletSummary(lawyerId, 'lawyer');

  res.json({
    stats: {
      earningsThisMonth: stats.earningsThisMonth,
      callsThisMonth: stats.callsThisMonth,
      overallCalls: stats.overallCalls,
      missedLeads: stats.missedLeads,
    },
    walletBalance: wallet.balance,
  });
});

const getWallet = asyncHandler(async (req, res) => {
  const filter = req.query.filter || 'all';
  const wallet = walletService.getWalletSummary(req.auth.sub, 'lawyer');
  const transactions = walletService.getFilteredTransactions(
    req.auth.sub,
    'lawyer',
    filter,
  );

  res.json({ balance: wallet.balance, transactions });
});

const withdrawWallet = asyncHandler(async (req, res) => {
  const amount = Number.parseFloat(req.body.amount);

  const result = walletService.withdrawLawyerBalance(req.auth.sub, amount);

  notificationService.createNotification(req.auth.sub, 'lawyer', {
    title: 'Withdrawal successful',
    body: `₹${amount} has been withdrawn from your wallet.`,
  });

  res.json(result);
});

const listAppointments = asyncHandler(async (req, res) => {
  const appointments = appointmentService.listLawyerAppointments(
    req.auth.sub,
    req.query.status,
  );
  res.json({ appointments });
});

const updateAppointmentStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  const appointment = appointmentService.updateAppointmentStatus(
    Number(req.params.id),
    status,
    req.auth.sub,
    'lawyer',
  );

  res.json({ appointment });
});

const listNotifications = asyncHandler(async (req, res) => {
  const notifications = notificationService.listNotifications(req.auth.sub, 'lawyer');
  res.json({ notifications });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = notificationService.markNotificationRead(
    req.auth.sub,
    'lawyer',
    Number(req.params.id),
  );
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({ notification });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.auth.sub, 'lawyer');
  res.json({ success: true });
});

module.exports = {
  getDashboardStats,
  getWallet,
  withdrawWallet,
  listAppointments,
  updateAppointmentStatus,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};

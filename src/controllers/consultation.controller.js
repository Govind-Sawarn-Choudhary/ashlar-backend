const asyncHandler = require('../utils/asyncHandler');
const consultationService = require('../services/consultation.service');

const getSession = asyncHandler(async (req, res) => {
  const payload = consultationService.getOrCreateSession(
    Number(req.params.appointmentId),
    req.auth.sub,
    req.auth.role,
  );
  res.json(payload);
});

const joinSession = asyncHandler(async (req, res) => {
  const payload = consultationService.joinSession(
    Number(req.params.appointmentId),
    req.auth.sub,
    req.auth.role,
  );
  res.json(payload);
});

const listMessages = asyncHandler(async (req, res) => {
  const afterId = Number.parseInt(req.query.afterId, 10) || 0;
  const messages = consultationService.listMessages(
    Number(req.params.sessionId),
    req.auth.sub,
    req.auth.role,
    afterId,
  );
  res.json({ messages });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { body } = req.body;
  const message = consultationService.sendMessage(
    Number(req.params.sessionId),
    req.auth.sub,
    req.auth.role,
    body,
  );
  res.status(201).json({ message });
});

const endSession = asyncHandler(async (req, res) => {
  const session = consultationService.endSession(
    Number(req.params.sessionId),
    req.auth.sub,
    req.auth.role,
  );
  res.json({ session });
});

const listConsultations = asyncHandler(async (req, res) => {
  const appointments = consultationService.listOnlineAppointments(
    req.auth.sub,
    req.auth.role,
    {
      status: req.query.status,
      consultationType: req.query.consultationType,
    },
  );
  res.json({ appointments });
});

module.exports = {
  getSession,
  joinSession,
  listMessages,
  sendMessage,
  endSession,
  listConsultations,
};

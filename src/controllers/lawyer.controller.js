const asyncHandler = require('../utils/asyncHandler');
const {
  buildLawyerAuthPayload,
  saveLawyerDetails,
  saveBarEnrollmentDraft,
  markDocumentsStepComplete,
  upsertLawyerDocument,
  saveLawyerAvailability,
  saveLawyerFees,
  DOC_TYPES,
} = require('../services/lawyer.service');

const getMe = asyncHandler(async (req, res) => {
  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  const payload = buildLawyerAuthPayload(user);
  res.json(payload);
});

const saveDetails = asyncHandler(async (req, res) => {
  const { fullName, practiceAreas, experienceYears, bio } = req.body;

  if (!fullName?.trim()) {
    return res.status(400).json({ error: 'fullName is required' });
  }

  saveLawyerDetails(req.auth.sub, {
    fullName,
    practiceAreas,
    experienceYears,
    bio,
  });

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildLawyerAuthPayload(user));
});

const uploadDocument = asyncHandler(async (req, res) => {
  const { docType } = req.body;

  if (!docType || !DOC_TYPES.includes(docType)) {
    return res.status(400).json({
      error: `docType is required and must be one of: ${DOC_TYPES.join(', ')}`,
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  upsertLawyerDocument(req.auth.sub, docType, {
    originalName: req.file.originalname,
    filePath: `/uploads/${req.file.filename}`,
    mimeType: req.file.mimetype,
  });

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildLawyerAuthPayload(user));
});

const completeDocuments = asyncHandler(async (req, res) => {
  const { enrollmentNumber, state } = req.body || {};

  if (enrollmentNumber?.trim()) {
    saveBarEnrollmentDraft(req.auth.sub, {
      state: state || 'UP',
      enrollmentNumber: enrollmentNumber.trim(),
    });
  }

  markDocumentsStepComplete(req.auth.sub);

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildLawyerAuthPayload(user));
});

const saveAvailability = asyncHandler(async (req, res) => {
  const { selectedDay, repeatWeekly, weekStart, weekEnd, fromTime, toTime } =
    req.body;

  if (!fromTime || !toTime) {
    return res.status(400).json({ error: 'fromTime and toTime are required' });
  }

  saveLawyerAvailability(req.auth.sub, {
    selectedDay,
    repeatWeekly,
    weekStart,
    weekEnd,
    fromTime,
    toTime,
  });

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildLawyerAuthPayload(user));
});

const saveFees = asyncHandler(async (req, res) => {
  const { fees } = req.body;
  saveLawyerFees(req.auth.sub, fees);

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildLawyerAuthPayload(user));
});

module.exports = {
  getMe,
  saveDetails,
  uploadDocument,
  completeDocuments,
  saveAvailability,
  saveFees,
};

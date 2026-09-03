const UP_COP_URL = 'http://upbarcouncil.com/AdvocateOnCop.aspx';

function stripHtml(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(providedName, portalName) {
  const provided = normalizeName(providedName);
  const portal = normalizeName(portalName);

  if (!provided || !portal) {
    return false;
  }

  return provided === portal;
}

function normalizeEnrollment(raw) {
  return String(raw || '').trim().toUpperCase();
}

function parseAdvocateTable(html) {
  if (
    html.includes('Please check your Enrollment Number')
    || html.includes('Please check your enrollment number')
  ) {
    return null;
  }

  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    stripHtml(m[1]),
  );

  const labels = {
    'Enroll No.:': 'enrollmentNumber',
    'Name of Advocate:': 'advocateName',
    'Father/Husband Name:': 'fatherName',
    'District :': 'district',
    'District:': 'district',
    'Date of Enrollment:': 'enrollmentDate',
    'Address :': 'address',
    'Address:': 'address',
    'COP No.:': 'copNumber',
    'Cop No.:': 'copNumber',
  };

  const result = {};

  for (let i = 0; i < cells.length; i += 1) {
    const cellText = cells[i].replace(/\s+/g, ' ').trim();
    let key = labels[cells[i]] || labels[cellText];
    if (!key) {
      const lower = cellText.toLowerCase();
      if (lower.includes('district')) {
        key = 'district';
      } else if (lower.includes('address')) {
        key = 'address';
      } else if (lower.includes('enroll') && lower.includes('no')) {
        key = 'enrollmentNumber';
      } else if (lower.includes('advocate')) {
        key = 'advocateName';
      }
    }

    if (key && cells[i + 1]) {
      result[key] = cells[i + 1];
    }
  }

  if (!result.enrollmentNumber || !result.advocateName) {
    return null;
  }

  return result;
}

async function fetchUpCopPage() {
  const response = await fetch(UP_COP_URL, {
    headers: {
      'User-Agent': 'AshlarLawyerHub/1.0 (+local verification)',
    },
  });

  if (!response.ok) {
    throw new Error('UP Bar Council portal is unavailable');
  }

  const html = await response.text();
  const viewState = html.match(/name="__VIEWSTATE" id="__VIEWSTATE" value="([^"]*)"/)?.[1];
  const viewStateGenerator = html.match(
    /name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="([^"]*)"/,
  )?.[1];
  const eventValidation = html.match(
    /name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="([^"]*)"/,
  )?.[1];

  if (!viewState || !viewStateGenerator || !eventValidation) {
    throw new Error('Could not read UP Bar Council search form');
  }

  const cookie = response.headers.get('set-cookie') || '';

  return {
    viewState,
    viewStateGenerator,
    eventValidation,
    cookie,
  };
}

async function searchEnrollmentOnUpCopPortal(enrollmentNumber, session) {
  const body = new URLSearchParams({
    __VIEWSTATE: session.viewState,
    __VIEWSTATEGENERATOR: session.viewStateGenerator,
    __EVENTVALIDATION: session.eventValidation,
    'ctl00$ContentPlaceHolder1$txtEnrollment': enrollmentNumber,
    'ctl00$ContentPlaceHolder1$txtcop': '',
    'ctl00$ContentPlaceHolder1$EffectsImageButton1.x': '1',
    'ctl00$ContentPlaceHolder1$EffectsImageButton1.y': '1',
  });

  const response = await fetch(UP_COP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      'User-Agent': 'AshlarLawyerHub/1.0 (+local verification)',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error('UP Bar Council search failed');
  }

  return response.text();
}

async function verifyUpEnrollment(rawEnrollmentNumber, fullName) {
  const inputEnrollmentNumber = normalizeEnrollment(rawEnrollmentNumber);
  const session = await fetchUpCopPage();
  const html = await searchEnrollmentOnUpCopPortal(inputEnrollmentNumber, session);
  const advocate = parseAdvocateTable(html);

  if (!advocate) {
    return {
      verified: false,
      enrollmentFound: false,
      needsManualReview: true,
      nameMatched: false,
      state: 'UP',
      inputEnrollmentNumber,
      matchedEnrollmentNumber: null,
      message: 'Enrollment number not found on UP Bar Council COP records',
      source: 'upbarcouncil.com/AdvocateOnCop.aspx',
    };
  }

  const portalPayload = {
    state: 'UP',
    inputEnrollmentNumber,
    matchedEnrollmentNumber: advocate.enrollmentNumber,
    advocateName: advocate.advocateName,
    fatherName: advocate.fatherName || null,
    district: advocate.district || null,
    enrollmentDate: advocate.enrollmentDate || null,
    address: advocate.address || null,
    copNumber: advocate.copNumber || null,
    source: 'upbarcouncil.com/AdvocateOnCop.aspx',
  };

  if (!fullName?.trim()) {
    return {
      ...portalPayload,
      verified: true,
      enrollmentFound: true,
      needsManualReview: false,
      nameMatched: null,
      message: `Enrollment verified. Profile updated to: ${advocate.advocateName}`,
    };
  }

  const nameMatched = namesMatch(fullName, advocate.advocateName);

  if (nameMatched) {
    return {
      ...portalPayload,
      verified: true,
      enrollmentFound: true,
      needsManualReview: false,
      nameMatched: true,
      message: `Verified: ${advocate.advocateName}. Profile updated from Bar Council records.`,
    };
  }

  return {
    ...portalPayload,
    verified: true,
    enrollmentFound: true,
    needsManualReview: false,
    nameMatched: false,
    message: `Name updated from Bar Council records: ${advocate.advocateName}`,
  };
}

module.exports = {
  normalizeName,
  namesMatch,
  verifyUpEnrollment,
};

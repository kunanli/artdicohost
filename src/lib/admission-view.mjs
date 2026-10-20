/** Saved waitlist entries and confirmed admission are distinct receipt states. */
export function registrationReceiptState(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const expected = body.status === 'registered' ? 'confirmed' : body.status === 'waitlisted' ? 'waitlisted' : null;
  if (!expected || body.admissionStatus !== undefined && body.admissionStatus !== expected) return null;
  if (body.admissionKind !== undefined && !['attendee', 'crew'].includes(body.admissionKind)) return null;
  if (body.admissionRevision !== undefined && (!Number.isSafeInteger(body.admissionRevision) || body.admissionRevision < 0)) return null;
  return expected;
}

/** Only complete, bounded server summary counts are displayed as capacity facts. */
export function admissionSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = ['capacity', 'staffReserve', 'confirmedCount', 'attendeeConfirmedCount', 'crewConfirmedCount', 'waitlistCount', 'remainingPublic', 'remainingTotal'];
  if (keys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1000)
    || value.capacity < 1 || value.staffReserve > value.capacity || typeof value.waitlistEnabled !== 'boolean'
    || value.confirmedCount !== value.attendeeConfirmedCount + value.crewConfirmedCount || value.confirmedCount > value.capacity
    || value.remainingTotal !== value.capacity - value.confirmedCount
    || value.attendeeConfirmedCount > value.capacity - value.staffReserve
    || value.remainingPublic !== Math.max(0, Math.min(value.remainingTotal, value.capacity - value.staffReserve - value.attendeeConfirmedCount))) return null;
  return { ...Object.fromEntries(keys.map(key => [key, value[key]])), waitlistEnabled: value.waitlistEnabled };
}

export const admissionLabels = Object.freeze({ confirmed: '已确认参会名额', waitlisted: '候补中 · 尚未确认参会', withdrawn: '已取消名额' });

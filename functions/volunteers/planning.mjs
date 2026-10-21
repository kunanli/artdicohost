import { isVolunteerPlainObject, validateVolunteerState, volunteerWindowsOverlap, VOLUNTEER_ID } from '../../shared/volunteer-schema.mjs';

const ACTIVE = new Set(['pending', 'invited', 'confirmed']);
const ADMISSION = new Set(['confirmed', 'waitlisted', 'withdrawn', 'unlinked']);
const IDENTITY = /^(?:c|r):[A-Za-z0-9_-]{1,80}$/u;
const add = (list, code) => { if (!list.includes(code)) list.push(code); };
function unavailable() { const error = new Error('志愿者来源或排班资料暂时无法核对。'); error.code = 'STORAGE_UNAVAILABLE'; error.status = 503; throw error; }
function identityFor(identities, source) {
  const key = source.kind + ':' + source.id;
  const value = identities instanceof Map ? identities.get(key) : Object.hasOwn(identities, key) ? identities[key] : undefined;
  return isVolunteerPlainObject(value) && typeof value.canonicalId === 'string' && IDENTITY.test(value.canonicalId)
    && typeof value.eligible === 'boolean' && ADMISSION.has(value.admissionStatus) ? value : null;
}
/** Adjacent saved windows may jointly cover a continuous shift; all times are local event-day HH:MM. */
export function volunteerAvailableFor(availability, shift) {
  let cursor = shift.start;
  for (const window of availability) {
    if (window.end <= cursor) continue;
    if (window.start > cursor) return false;
    cursor = window.end;
    if (cursor >= shift.end) return true;
  }
  return false;
}
function contentIds(items) {
  if (!Array.isArray(items)) unavailable();
  const result = new Map();
  for (const item of items) {
    if (!isVolunteerPlainObject(item) || typeof item.id !== 'string' || !VOLUNTEER_ID.test(item.id) || result.has(item.id)
      || typeof item.status !== 'string') unavailable();
    result.set(item.id, item);
  }
  return result;
}

/** Pure private projection. Names and contact fields are deliberately absent from the result. */
export function projectVolunteerCoverage(input, context) {
  const state = validateVolunteerState(input);
  if (!isVolunteerPlainObject(context) || !(context.identities instanceof Map || isVolunteerPlainObject(context.identities)) || !isVolunteerPlainObject(context.content)) unavailable();
  const sessions = contentIds(context.content.sessions), booths = contentIds(context.content.booths);
  const positions = new Map(state.positions.map(item => [item.id, item]));
  const shiftsById = new Map(state.shifts.map(item => [item.id, item]));
  const peopleById = new Map(state.volunteers.map(item => [item.id, item]));
  const identities = new Map(), duplicates = new Map(), people = [], shiftViews = [], allocations = [];
  for (const volunteer of state.volunteers) {
    const identity = identityFor(context.identities, volunteer.source), issues = [];
    identities.set(volunteer.id, identity);
    if (!identity) add(issues, 'SOURCE_UNAVAILABLE');
    else if (!identity.eligible) add(issues, 'SOURCE_INELIGIBLE');
    if (!ACTIVE.has(volunteer.workflowStatus)) add(issues, 'VOLUNTEER_INACTIVE');
    if (identity && ACTIVE.has(volunteer.workflowStatus)) {
      const group = duplicates.get(identity.canonicalId) ?? []; group.push(volunteer.id); duplicates.set(identity.canonicalId, group);
    }
    people.push({ id: volunteer.id, identityKey: identity?.canonicalId ?? null, eligible: Boolean(identity?.eligible && ACTIVE.has(volunteer.workflowStatus)), issues });
  }
  const peopleViews = new Map(people.map(item => [item.id, item]));
  for (const ids of duplicates.values()) if (ids.length > 1) for (const id of ids) {
    const person = peopleViews.get(id); add(person.issues, 'DUPLICATE_PERSON'); person.eligible = false;
  }
  for (const shift of state.shifts) {
    const issues = [];
    if (shift.status !== 'active') add(issues, 'SHIFT_CANCELLED');
    if (positions.get(shift.positionId).status !== 'active') add(issues, 'POSITION_INACTIVE');
    if (shift.sessionId && (!sessions.has(shift.sessionId) || sessions.get(shift.sessionId).status === 'cancelled')
      || shift.boothId && (!booths.has(shift.boothId) || booths.get(shift.boothId).status === 'cancelled')) add(issues, 'CONTENT_LINK_INVALID');
    shiftViews.push({ id: shift.id, required: shift.required, proposedCount: 0, confirmedCount: 0, gap: 0, issues });
  }
  const shiftViewsById = new Map(shiftViews.map(item => [item.id, item]));
  for (const assignment of state.assignments) {
    const issues = [], volunteer = peopleById.get(assignment.volunteerId), shift = shiftsById.get(assignment.shiftId), identity = identities.get(volunteer.id);
    if (assignment.status !== 'cancelled') {
      for (const code of peopleViews.get(volunteer.id).issues) add(issues, code);
      for (const code of shiftViewsById.get(shift.id).issues) add(issues, code);
      if (!volunteerAvailableFor(volunteer.availability, shift)) add(issues, 'OUTSIDE_AVAILABILITY');
      if (assignment.status === 'confirmed') {
        if (volunteer.workflowStatus !== 'confirmed') add(issues, 'VOLUNTEER_NOT_CONFIRMED');
        if (!identity || identity.admissionStatus !== 'confirmed') add(issues, 'ADMISSION_NOT_CONFIRMED');
      }
    }
    allocations.push({ id: assignment.id, volunteerId: assignment.volunteerId, shiftId: assignment.shiftId, status: assignment.status,
      valid: assignment.status !== 'cancelled' && issues.length === 0, issues });
  }
  // All live proposals reserve the person's time, even before admission is confirmed.
  const reservations = new Map();
  for (const allocation of allocations) {
    const person = peopleById.get(allocation.volunteerId), identity = identities.get(person.id), shift = shiftsById.get(allocation.shiftId);
    if (allocation.status === 'cancelled' || !identity || !ACTIVE.has(person.workflowStatus) || shift.status !== 'active'
      || positions.get(shift.positionId).status !== 'active') continue;
    const previous = reservations.get(identity.canonicalId) ?? [];
    for (const other of previous) if (volunteerWindowsOverlap(shift, shiftsById.get(other.shiftId))) {
      add(allocation.issues, 'TIME_CONFLICT'); add(other.issues, 'TIME_CONFLICT'); allocation.valid = false; other.valid = false;
    }
    previous.push(allocation); reservations.set(identity.canonicalId, previous);
  }
  const assigned = new Set();
  for (const allocation of allocations) if (allocation.valid) {
    const shift = shiftViewsById.get(allocation.shiftId);
    shift[allocation.status === 'confirmed' ? 'confirmedCount' : 'proposedCount']++;
    assigned.add(identities.get(allocation.volunteerId).canonicalId);
  }
  let requiredSlots = 0, proposedSlots = 0, confirmedSlots = 0, unfilledSlots = 0;
  for (const shift of shiftViews) {
    if (shift.proposedCount + shift.confirmedCount > shift.required) add(shift.issues, 'SHIFT_OVER_CAPACITY');
    if (!shift.issues.includes('SHIFT_CANCELLED') && !shift.issues.includes('POSITION_INACTIVE')) {
      shift.gap = Math.max(0, shift.required - shift.confirmedCount); requiredSlots += shift.required; unfilledSlots += shift.gap;
    }
    proposedSlots += shift.proposedCount; confirmedSlots += shift.confirmedCount;
  }
  const active = new Set(), confirmed = new Set(), admitted = new Set();
  for (const volunteer of state.volunteers) {
    const identity = identities.get(volunteer.id);
    if (!identity?.eligible || !ACTIVE.has(volunteer.workflowStatus)) continue;
    active.add(identity.canonicalId);
    if (volunteer.workflowStatus === 'confirmed') confirmed.add(identity.canonicalId);
    if (identity.admissionStatus === 'confirmed') admitted.add(identity.canonicalId);
  }
  const issues = [
    ...people.flatMap(item => item.issues.map(code => ({ code, volunteerId: item.id }))),
    ...shiftViews.flatMap(item => item.issues.map(code => ({ code, shiftId: item.id }))),
    ...allocations.flatMap(item => item.issues.map(code => ({ code, volunteerId: item.volunteerId, shiftId: item.shiftId, assignmentId: item.id }))),
  ];
  return { summary: { rosterCount: state.volunteers.length, activeVolunteerCount: active.size, confirmedVolunteerCount: confirmed.size,
    admissionConfirmedCount: admitted.size, assignedVolunteerCount: assigned.size, requiredSlots, proposedSlots, confirmedSlots, unfilledSlots,
    unverifiableSources: people.filter(item => item.identityKey === null).length }, shifts: shiftViews, assignments: allocations, volunteers: people, issues };
}

function conflict(details) { const error = new Error('这项安排与已保存的时段、参与状态或岗位需求冲突，请先核对。'); error.code = 'PLAN_CONFLICT'; error.status = 422; error.details = details; throw error; }
/** Invalidating edits preserve history; restoring eligibility must not introduce new scheduling conflicts. */
export function assertVolunteerPlanChange(before, after, { action, id } = {}, context) {
  const next = projectVolunteerCoverage(after, context);
  if (action === 'volunteer_upsert' && ACTIVE.has(after.volunteers.find(item => item.id === id)?.workflowStatus)
    || action === 'position_upsert' && after.positions.find(item => item.id === id)?.status === 'active') {
    const old = projectVolunteerCoverage(before, context), reasons = [];
    for (const item of next.assignments) if (item.issues.includes('TIME_CONFLICT')
      && !old.assignments.find(candidate => candidate.id === item.id)?.issues.includes('TIME_CONFLICT'))
      reasons.push({ code: 'TIME_CONFLICT', assignmentId: item.id, volunteerId: item.volunteerId, shiftId: item.shiftId });
    for (const item of next.shifts) {
      const previous = old.shifts.find(candidate => candidate.id === item.id);
      if (item.issues.includes('SHIFT_OVER_CAPACITY') && (!previous?.issues.includes('SHIFT_OVER_CAPACITY')
        || item.confirmedCount + item.proposedCount > previous.confirmedCount + previous.proposedCount)) reasons.push({ code: 'SHIFT_OVER_CAPACITY', shiftId: item.id });
    }
    if (reasons.length) conflict(reasons);
  }
  if (action === 'assignment_upsert') {
    const target = next.assignments.find(item => item.id === id);
    if (!target) conflict([{ code: 'SOURCE_UNAVAILABLE', assignmentId: id }]);
    if (target.status !== 'cancelled') {
      const reasons = target.issues.map(code => ({ code, assignmentId: id, volunteerId: target.volunteerId, shiftId: target.shiftId }));
      if (next.shifts.find(item => item.id === target.shiftId).issues.includes('SHIFT_OVER_CAPACITY')) reasons.push({ code: 'SHIFT_OVER_CAPACITY', shiftId: target.shiftId });
      if (reasons.length) conflict(reasons);
    }
  } else if (action === 'shift_upsert') {
    const shift = after.shifts.find(item => item.id === id), previous = before.shifts.find(item => item.id === id);
    if (!shift) conflict([{ code: 'SHIFT_CANCELLED', shiftId: id }]);
    if (shift.status !== 'cancelled') {
      const moved = !previous || ['positionId', 'start', 'end', 'required', 'sessionId', 'boothId', 'status'].some(key => previous[key] !== shift[key]);
      if (moved) {
        const old = projectVolunteerCoverage(before, context), affected = new Set(after.assignments.filter(item => item.shiftId === id && item.status !== 'cancelled').map(item => item.id));
        const reasons = [];
        for (const item of next.assignments) {
          const previousIssues = old.assignments.find(candidate => candidate.id === item.id)?.issues ?? [];
          // Include conflicts on the other shift created by moving this shift, without blocking unrelated existing issues.
          for (const code of item.issues) if (affected.has(item.id) || !previousIssues.includes(code)) reasons.push({ code, assignmentId: item.id, volunteerId: item.volunteerId, shiftId: item.shiftId });
        }
        const view = next.shifts.find(item => item.id === id);
        for (const code of view.issues) if (code === 'SHIFT_OVER_CAPACITY' || code === 'CONTENT_LINK_INVALID' || code === 'POSITION_INACTIVE') reasons.push({ code, shiftId: id });
        if (reasons.length) conflict(reasons);
      }
    }
  }
  return next;
}

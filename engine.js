/* Budget engine: pay periods, budget conversion, pace colors, and the payday close (carryover + payback).
   Pure JavaScript with no browser or Google calls, so the Sheet's script and the phone screens share it.
   Dates are 'YYYY-MM-DD' strings throughout. */
var BudgetEngine = (function () {
  'use strict';

  /* ---------- Dates ---------- */
  function parse(s) { var p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmt(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); } // b - a
  function weekday(s) { return parse(s).getUTCDay(); } // 0 = Sunday
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-12
  function ym(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymdOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /* ---------- Pay periods ----------
     person: { cadence: 'weekly'|'biweekly'|'semimonthly'|'monthly', payday: weekday 0-6 (weekly),
               anchor: 'YYYY-MM-DD' (biweekly), payday as day of month (monthly) }
     semimonthly periods are the 1st–14th and the 15th–end of month. */
  function periodFor(p, date) {
    var start, end;
    if (p.cadence === 'weekly') {
      var back = (weekday(date) - Number(p.payday) + 7) % 7;
      start = addDays(date, -back); end = addDays(start, 6);
    } else if (p.cadence === 'biweekly') {
      var k = Math.floor(diffDays(p.anchor, date) / 14);
      start = addDays(p.anchor, k * 14); end = addDays(start, 13);
    } else if (p.cadence === 'semimonthly') {
      var t = ym(date);
      if (t.d < 15) { start = ymdOf(t.y, t.m, 1); end = ymdOf(t.y, t.m, 14); }
      else { start = ymdOf(t.y, t.m, 15); end = ymdOf(t.y, t.m, daysInMonth(t.y, t.m)); }
    } else { // monthly, on day N (capped at the month's last day)
      var u = ym(date), day = Math.min(Number(p.payday) || 1, daysInMonth(u.y, u.m));
      var sy = u.y, sm = u.m;
      if (u.d < day) { sm -= 1; if (sm === 0) { sm = 12; sy -= 1; } }
      start = ymdOf(sy, sm, Math.min(Number(p.payday) || 1, daysInMonth(sy, sm)));
      var ny = sy, nm = sm + 1; if (nm === 13) { nm = 1; ny += 1; }
      end = addDays(ymdOf(ny, nm, Math.min(Number(p.payday) || 1, daysInMonth(ny, nm))), -1);
    }
    return { start: start, end: end, days: diffDays(start, end) + 1 };
  }
  function nextPeriod(p, period) { return periodFor(p, addDays(period.end, 1)); }
  function periodsPerYear(cadence) { return { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[cadence] || 52; }
  function cadenceLabel(cadence) {
    return { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Twice a month', monthly: 'Monthly' }[cadence] || cadence;
  }

  /* ---------- Views (the Home toggle) ----------
     Each person sees Daily, Weekly, their own pay period, and Monthly. A weekly person's third view is Bi-weekly. */
  function viewsFor(p) {
    var third = p.cadence === 'weekly' ? { id: 'biweek', label: 'Bi-weekly' }
      : p.cadence === 'monthly' ? { id: 'biweek', label: 'Bi-weekly' }
      : { id: 'native', label: p.cadence === 'biweekly' ? 'Bi-weekly' : 'Pay period' };
    var week = p.cadence === 'weekly' ? { id: 'native', label: 'Weekly' } : { id: 'week', label: 'Weekly' };
    var month = p.cadence === 'monthly' ? { id: 'native', label: 'Monthly' } : { id: 'month', label: 'Monthly' };
    return [{ id: 'day', label: 'Daily' }, week, third, month];
  }
  /** The date window a view covers on a given day. */
  function windowFor(p, view, date) {
    if (view === 'native') return periodFor(p, date);
    if (view === 'day') return { start: date, end: date, days: 1 };
    if (view === 'week') { var b = (weekday(date) + 6) % 7, s = addDays(date, -b); return { start: s, end: addDays(s, 6), days: 7 }; } // Mon–Sun
    if (view === 'biweek') {
      var anchor = p.cadence === 'weekly' ? periodFor(p, p.startDate || date).start : '2026-01-05';
      var k = Math.floor(diffDays(anchor, date) / 14), st = addDays(anchor, k * 14);
      return { start: st, end: addDays(st, 13), days: 14 };
    }
    if (view === 'month') { var t = ym(date), e = ymdOf(t.y, t.m, daysInMonth(t.y, t.m)); return { start: ymdOf(t.y, t.m, 1), end: e, days: daysInMonth(t.y, t.m) }; }
    if (view === 'quarter') {
      var q = ym(date), qm = Math.floor((q.m - 1) / 3) * 3 + 1, qe = qm + 2;
      var qs = ymdOf(q.y, qm, 1), qend = ymdOf(q.y, qe, daysInMonth(q.y, qe));
      return { start: qs, end: qend, days: diffDays(qs, qend) + 1 };
    }
    if (view === 'year') { var y = ym(date).y; return { start: y + '-01-01', end: y + '-12-31', days: diffDays(y + '-01-01', y + '-12-31') + 1 }; }
    return periodFor(p, date);
  }
  /** Converts a pay-period amount into another view: $175/week -> $25/day, $350/2 weeks, $758.33/month. */
  function convert(amount, cadence, view, days) {
    if (view === 'native') return amount;
    var weekly = amount * periodsPerYear(cadence) / 52;
    if (view === 'day') return weekly / 7;
    if (view === 'week') return weekly;
    if (view === 'biweek') return weekly * 2;
    if (view === 'month') return amount * periodsPerYear(cadence) / 12;
    if (view === 'quarter') return amount * periodsPerYear(cadence) / 4;
    if (view === 'year') return amount * periodsPerYear(cadence);
    return weekly / 7 * (days || 7);
  }

  /* ---------- Pace colors ----------
     Compares the share of the budget used with the share of the period gone.
     ok: within 10 points of pace; warn: 10–25 points ahead; over: more than 25 ahead, or over budget. */
  function pace(spent, budget, window, today) {
    var dayIdx = Math.min(window.days, Math.max(1, diffDays(window.start, today) + 1));
    var elapsed = dayIdx / window.days;
    if (budget <= 0) return { status: spent > 0.004 ? 'over' : 'ok', used: spent > 0 ? 1 : 0, elapsed: elapsed, overBudget: spent > 0.004 };
    var used = spent / budget, ahead = used - elapsed;
    var over = spent - budget > 0.004;
    var status = over || ahead > 0.25 ? 'over' : ahead > 0.10 ? 'warn' : 'ok';
    return { status: status, used: used, elapsed: elapsed, ahead: ahead, overBudget: over };
  }

  /* ---------- Payday close ----------
     Replays every closed pay period in order. Each snapshot holds only what was true when it closed:
     { start, end, budgets: {catId: amount}, spent: {catId: amount}, adjust: number, option: 'A'|'B'|'C'|null }
     adjust = changes to entries from earlier closed periods, booked here (positive = more spending).
     option null = the person picks D ("choose each payday") and hasn't answered yet; treated as A until they do.
     Returns the running state for the current period plus one outcome per snapshot (for stats). */
  function sum(o) { var t = 0; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) t += Number(o[k]) || 0; return t; }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function replay(person, snaps) {
    var carry = Number(person.startCarry) || 0, catCarry = {}, debt = 0, saved = 0, out = [];
    var max = Number(person.paybackMax) || 0;
    snaps.forEach(function (s) {
      var applied = Math.min(debt, max); debt = round2(debt - applied);
      var budgetTotal = sum(s.budgets), carryIn = carry + sum(catCarry);
      var available = budgetTotal + carryIn - applied;
      var spentTotal = sum(s.spent) + (Number(s.adjust) || 0);
      var net = round2(available - spentTotal);
      var o = { start: s.start, end: s.end, budgetTotal: round2(budgetTotal), spentTotal: round2(sum(s.spent)), adjust: round2(s.adjust || 0),
        carryIn: round2(carryIn), paybackApplied: round2(applied), option: s.option, pending: s.option == null };
      if (net >= 0) {
        var pay = Math.min(net, debt); debt = round2(debt - pay);
        var left = round2(net - pay), route = s.option || 'A';
        o.leftover = left; o.paidFromLeftover = round2(pay); o.overspent = 0;
        if (route === 'C') { saved = round2(saved + left); carry = 0; catCarry = {}; }
        else if (route === 'B') {
          var pos = {}, tot = 0;
          Object.keys(s.budgets).forEach(function (c) {
            var r = (Number(s.budgets[c]) || 0) + (Number(catCarry[c]) || 0) - (Number(s.spent[c]) || 0);
            if (r > 0) { pos[c] = r; tot += r; }
          });
          catCarry = {}; carry = 0;
          if (tot > 0) Object.keys(pos).forEach(function (c) { catCarry[c] = round2(left * pos[c] / tot); });
          else carry = left;
        } else { carry = left; catCarry = {}; }
      } else {
        o.leftover = 0; o.paidFromLeftover = 0; o.overspent = round2(-net);
        debt = round2(debt - net); carry = 0; catCarry = {};
      }
      o.carryOut = round2(carry + sum(catCarry)); o.debtAfter = debt; o.savedAfter = saved;
      out.push(o);
    });
    var appliedNow = Math.min(debt, max);
    return {
      carry: round2(carry), catCarry: catCarry, saved: saved,
      debtTotal: round2(debt),                 // still owed, including this period's piece
      paybackThisPeriod: round2(appliedNow),   // taken out of the current period
      periodsLeft: max > 0 && debt > 0 ? Math.ceil(debt / max - 1e-9) : 0,
      outcomes: out
    };
  }

  /** Splits an edit to an entry into the part that lands in already-closed periods (booked as an adjustment now). */
  function closedDelta(oldEntry, newEntry, currentStart) {
    var d = 0;
    if (newEntry && newEntry.date < currentStart) d += Number(newEntry.amount) || 0;
    if (oldEntry && oldEntry.date < currentStart) d -= Number(oldEntry.amount) || 0;
    return round2(d);
  }

  return {
    parse: parse, fmt: fmt, addDays: addDays, diffDays: diffDays, weekday: weekday, daysInMonth: daysInMonth,
    periodFor: periodFor, nextPeriod: nextPeriod, periodsPerYear: periodsPerYear, cadenceLabel: cadenceLabel,
    viewsFor: viewsFor, windowFor: windowFor, convert: convert, pace: pace,
    replay: replay, closedDelta: closedDelta, sum: sum, round2: round2
  };
})();
if (typeof module !== 'undefined') module.exports = BudgetEngine;

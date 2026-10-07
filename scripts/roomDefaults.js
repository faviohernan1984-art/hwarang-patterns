import { emptyPublicState } from '../src/publicState.js';

export function initialRoomDocuments() {
  const control = {
    evaluationId: 1, status: 'paused', phase: 'fight', phaseStartedAt: null, pausedRemaining: 120,
    config: { roundSeconds: 120, patternJudges: 3, scoringMode: 'binary' },
    hong: { label: 'HONG', name: 'HONG', club: '' },
    chong: { label: 'CHONG', name: 'CHONG', club: '' }, publicSwapSides: false,
  };
  const meta = { presidentSwapSides: false, patternResult: { hong: 0, chong: 0, sent: 0, completed: false, winner: 'en_curso' } };
  return [control, meta, emptyPublicState(control)];
}

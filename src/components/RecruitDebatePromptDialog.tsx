import { useGame } from '../game/store/GameProvider';
import type { CityId } from '../game/types';

/**
 * 跨城登庸的舌战抉择弹窗：执行武将已抵达目标城，对方尚有出仕意愿，
 * 玩家选择「进行舌战」则进入舌战界面，选择「放弃登庸」则登上返程、班师回城。
 */
export function RecruitDebatePromptDialog() {
  const { state, issueCommand } = useGame();
  const pending = state?.pendingRecruitDebate;
  if (!pending || !state) return null;

  const recruiter = state.officers[pending.recruiterId];
  const target = state.officers[pending.targetId];
  const journey = recruiter?.location?.kind === 'recruitJourney' ? recruiter.location : undefined;
  const targetCity = journey ? state.cities[journey.targetCityId] : undefined;
  const homeCityName = journey ? state.cities[journey.fromCityId as CityId]?.name : undefined;
  if (!recruiter || !target) return null;

  const onAccept = () => {
    const journeyLoc = recruiter.location;
    if (journeyLoc.kind !== 'recruitJourney') return;
    issueCommand({
      type: 'acceptRecruitDebate',
      cityId: journeyLoc.fromCityId,
      officerId: recruiter.id,
      targetOfficerId: target.id,
    });
  };

  const onReject = () => {
    const journeyLoc = recruiter.location;
    if (journeyLoc.kind !== 'recruitJourney') return;
    issueCommand({
      type: 'rejectRecruitDebate',
      cityId: journeyLoc.fromCityId,
      officerId: recruiter.id,
      targetOfficerId: target.id,
    });
  };

  return (
    <div className="debate-modal-mask" role="dialog" aria-label="登庸抉择">
      <div className="settlement-modal recruit-debate-prompt">
        <h3 className="settlement-title">登庸 · 舌战抉择</h3>
        <p className="settlement-text">
          {recruiter.name}已抵达{targetCity?.name ?? '目标城'}，面见{target.name}。
          {target.name}尚有出仕意愿，是否以舌战劝说其加入我方？
        </p>
        <p className="settlement-text hint">
          {target.name}若应允，将与{recruiter.name}结伴返回{homeCityName ?? '出发城'}；
          若舌战失利，{recruiter.name}将只身返回。
        </p>
        <footer className="recruit-debate-actions">
          <button type="button" className="modal-btn ghost" onClick={onReject}>放弃登庸</button>
          <button type="button" className="modal-btn primary" onClick={onAccept}>进行舌战</button>
        </footer>
      </div>
    </div>
  );
}
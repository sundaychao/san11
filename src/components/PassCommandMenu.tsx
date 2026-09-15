import { useGame } from '../game/store/GameProvider';
import type { CityId, DiplomacyAction, GameCommand, PassId } from '../game/types';
import type { CultivateCategory } from './CultivateDialog';
import { CityCommandMenu } from './CityCommandMenu';

interface PassCommandMenuProps {
  passId: PassId;
  actionPoints: number;
  position: { x: number; y: number };
  onCommand(type: GameCommand['type'], passId?: PassId, diplomacyAction?: DiplomacyAction): void;
  onAppointPosition?(): void;
  onBanish?(cityId: CityId): void;
  onCultivate(category: CultivateCategory, passId?: PassId): void;
  onOpenCultivatePicker?(passId?: PassId): void;
  onDeploy(strongholdId: CityId | PassId): void;
  onTransport(strongholdId: CityId | PassId): void;
  onClose(): void;
}

/**
 * 关隘命令菜单 = 城池命令菜单去掉「都市」段。
 * 除都市相关操作外，其余各段（军事/人才/科技树/外交/君主）均以关隘自身为宿主执行
 * （武将/训练/巡查/钱粮等判断与结算均落在关隘驻军与关隘资源上）。
 */
export function PassCommandMenu({ passId, actionPoints, position, onCommand, onAppointPosition, onBanish, onCultivate, onOpenCultivatePicker, onDeploy, onTransport, onClose }: PassCommandMenuProps) {
  const { state } = useGame();
  const pass = state?.passes?.[passId];
  if (!pass) return null;
  return (
    <CityCommandMenu
      cityId={pass.homeCityId}
      passId={passId}
      hideUrban
      actionPoints={actionPoints}
      merchantAvailable={false}
      position={position}
      onCommand={onCommand}
      onAppointPosition={onAppointPosition}
      onBanish={onBanish}
      onCultivate={onCultivate}
      onOpenCultivatePicker={onOpenCultivatePicker}
      onDeploy={onDeploy}
      onTransport={onTransport}
      onClose={onClose}
    />
  );
}
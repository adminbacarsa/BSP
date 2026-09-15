export type ResetPlanificacionVacancyModalParams = {
    setShowVacancyModal: (value: boolean) => void;
    setVacancyData: (value: null) => void;
    setVacancyReplacementSearch: (value: string) => void;
    setVacancyReplacementOpen: (value: boolean) => void;
    setVacancyActiveDates: (value: Set<string>) => void;
    setVacancyDayCoverages: (value: Record<string, any>) => void;
    setVacancyFrancoAuthApproved: (value: boolean) => void;
    setVacancyEditingDay: (value: null) => void;
    setVacancyPickerTab: (value: 'substitute' | 'split') => void;
    setVacancySplitExtId: (value: string) => void;
    setVacancySplitAdelId: (value: string) => void;
    setVacancyApplyToAllSelected: (value: boolean) => void;
};

export function resetPlanificacionVacancyModal({
    setShowVacancyModal,
    setVacancyData,
    setVacancyReplacementSearch,
    setVacancyReplacementOpen,
    setVacancyActiveDates,
    setVacancyDayCoverages,
    setVacancyFrancoAuthApproved,
    setVacancyEditingDay,
    setVacancyPickerTab,
    setVacancySplitExtId,
    setVacancySplitAdelId,
    setVacancyApplyToAllSelected,
}: ResetPlanificacionVacancyModalParams): void {
    setShowVacancyModal(false);
    setVacancyData(null);
    setVacancyReplacementSearch('');
    setVacancyReplacementOpen(false);
    setVacancyActiveDates(new Set());
    setVacancyDayCoverages({});
    setVacancyFrancoAuthApproved(false);
    setVacancyEditingDay(null);
    setVacancyPickerTab('substitute');
    setVacancySplitExtId('');
    setVacancySplitAdelId('');
    setVacancyApplyToAllSelected(true);
}

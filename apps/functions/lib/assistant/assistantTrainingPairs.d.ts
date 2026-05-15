export type AssistantTrainingPair = {
    id: number;
    categoria: string;
    pregunta_usuario: string;
    herramienta_sugerida?: string;
    respuesta_ideal_bullet: string;
};
export declare const ASSISTANT_TRAINING_PAIRS: AssistantTrainingPair[];
export declare const ASSISTANT_TRAINING_PAIR_COUNT: number;

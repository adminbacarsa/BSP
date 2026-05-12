export interface IApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}
export interface IEmployee {
    uid: string;
    name: string;
    role: string;
}

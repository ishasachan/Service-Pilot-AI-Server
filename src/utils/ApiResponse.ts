export default class ApiResponse {
  static success(
    message: string,
    data?: unknown
  ) {
    return {
      success: true,
      message,
      data,
    };
  }

  static error(
    message: string
  ) {
    return {
      success: false,
      message,
    };
  }
}
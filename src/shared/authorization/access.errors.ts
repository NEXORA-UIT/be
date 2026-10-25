import { AppError } from '../errors/app.error.js';

export const accessErrors = {
  notFound: (resource = 'Tài nguyên') =>
    new AppError(404, 'NOT_FOUND', `${resource} không tồn tại`),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này'),
  archived: () => new AppError(403, 'RESOURCE_ARCHIVED', 'Tài nguyên đang được lưu trữ'),
  frozen: () => new AppError(403, 'WORKSPACE_FROZEN', 'Workspace đang bị đóng băng'),
};

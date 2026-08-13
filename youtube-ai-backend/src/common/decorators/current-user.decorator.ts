import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface AuthenticatedRequest {
  user?: {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
  };
}

/**
 * Extracts the current authenticated user from the request.
 * Use @CurrentUser() user in controller methods.
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data as keyof typeof user] : user;
  },
);

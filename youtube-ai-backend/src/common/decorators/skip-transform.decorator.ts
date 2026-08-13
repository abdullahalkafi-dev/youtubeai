import { SetMetadata } from '@nestjs/common';
import { SKIP_TRANSFORM_KEY } from '../interceptors/transform.interceptor';

export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);

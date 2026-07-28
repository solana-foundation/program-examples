export * from './Car';
export * from './RentalOrder';

import { Car } from './Car';
import { RentalOrder } from './RentalOrder';

export const accountProviders = { Car, RentalOrder };

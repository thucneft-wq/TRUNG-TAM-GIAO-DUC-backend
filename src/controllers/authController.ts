import type { Request, Response } from 'express';
import { loginSchema } from '../schemas/authSchemas.js';
import type { AuthServicePort } from '../types/services.js';

export class AuthController {
  constructor(private readonly authService: AuthServicePort) {}

  login = async (request: Request, response: Response): Promise<void> => {
    const input = loginSchema.parse(request.body);
    const result = await this.authService.login(input.email, input.password);
    response.status(200).json(result);
  };
}

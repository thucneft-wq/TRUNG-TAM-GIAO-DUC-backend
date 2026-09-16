import type { Request, Response } from 'express';
import {
  createStudentSchema,
  studentIdSchema,
  updateStudentSchema,
} from '../schemas/studentSchemas.js';
import {
  googleSheetsAssignmentSchema,
} from '../schemas/googleSheetsSchemas.js';
import type { AnalyticsServicePort, StudentServicePort } from '../types/services.js';
import type { StudentAccessScope } from '../types/student.js';

const getScope = (request: Request): StudentAccessScope => ({
  role: request.auth?.role ?? 'counselor',
  counselorId: request.auth?.role === 'counselor' ? request.auth.sub : null,
});

export class StudentController {
  constructor(
    private readonly studentService: StudentServicePort,
    private readonly analyticsService: AnalyticsServicePort,
  ) {}

  list = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ students: await this.studentService.list(getScope(request)) });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const id = studentIdSchema.parse(request.params.id);
    response.status(200).json({ student: await this.studentService.getById(id, getScope(request)) });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const input = createStudentSchema.parse(request.body);
    const student = await this.studentService.create(input, getScope(request));
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'CREATE_STUDENT',
      'Student',
      student.id,
    );
    response.status(201).json({ student });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const id = studentIdSchema.parse(request.params.id);
    const input = updateStudentSchema.parse(request.body);
    const student = await this.studentService.update(id, input, getScope(request));
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'UPDATE_STUDENT',
      'Student',
      id,
    );
    response.status(200).json({ student });
  };

  deactivate = async (request: Request, response: Response): Promise<void> => {
    const id = studentIdSchema.parse(request.params.id);
    await this.studentService.deactivate(id, getScope(request));
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'DEACTIVATE_STUDENT',
      'Student',
      id,
    );
    response.status(204).send();
  };

  syncFromGoogleSheets = async (request: Request, response: Response): Promise<void> => {
    const input = createStudentSchema.parse(request.body);
    const result = await this.studentService.syncFromGoogleSheets(input);
    await this.analyticsService.recordAudit(
      'google-sheets',
      result.created ? 'SYNC_CREATE_STUDENT' : 'SYNC_UPDATE_STUDENT',
      'Student',
      result.student.id,
    );
    response.status(result.created ? 201 : 200).json(result);
  };

  syncAssignmentFromGoogleSheets = async (request: Request, response: Response): Promise<void> => {
    const input = googleSheetsAssignmentSchema.parse(request.body);
    const assignment = await this.studentService.syncAssignmentFromGoogleSheets(input);
    await this.analyticsService.recordAudit(
      'google-sheets',
      assignment.status === 'ACTIVE'
        ? (assignment.created ? 'SYNC_CREATE_ASSIGNMENT' : 'SYNC_UPDATE_ASSIGNMENT')
        : 'SYNC_END_ASSIGNMENT',
      'CounselorAssignment',
      assignment.assignmentId,
    );
    response.status(assignment.created ? 201 : 200).json({ assignment });
  };
}

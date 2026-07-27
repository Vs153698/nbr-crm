import { Body, Controller, Get, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  createNoteSchema,
  updateNoteSchema,
  uuidSchema,
} from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { NotesService, type NoteItem } from './notes.service';

@Controller('notes')
class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @Can(MODULES.NOTES, ACTIONS.VIEW)
  async list(
    @Query('applicantId') applicantId: string,
    @Query('recordId') recordId?: string,
  ): Promise<NoteItem[]> {
    return this.notes.list(
      uuidSchema.parse(applicantId),
      recordId ? uuidSchema.parse(recordId) : undefined,
    );
  }

  @Post()
  @Can(MODULES.NOTES, ACTIONS.CREATE)
  async create(
    @Body(zodBody(createNoteSchema))
    body: {
      applicantId: string;
      recordId?: string;
      body: string;
      category: string;
      priority: string;
      followUpDate?: Date;
      visibleToRoleIds?: string[];
    },
  ): Promise<{ id: string }> {
    return this.notes.create(body);
  }

  /** Editing appends a revision; the previous text is never lost (§14). */
  @Put(':id')
  @Can(MODULES.NOTES, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateNoteSchema)) body: { body: string; editReason?: string },
  ): Promise<{ ok: true }> {
    await this.notes.update(uuidSchema.parse(id), body.body, body.editReason);
    return { ok: true };
  }

  @Get(':id/revisions')
  @Can(MODULES.NOTES, ACTIONS.VIEW)
  async revisions(@Param('id') id: string) {
    return this.notes.revisions(uuidSchema.parse(id));
  }
}

@Module({
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}

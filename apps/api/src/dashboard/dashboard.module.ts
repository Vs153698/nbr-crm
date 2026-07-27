import { Controller, Get, Module, Query } from '@nestjs/common';
import { ACTIONS, MODULES } from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { SearchService, type SearchResults } from '../search/search.service';
import { DashboardService, type DashboardPayload } from './dashboard.service';

@Controller('dashboard')
class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * The whole dashboard in one call (§2, W-03).
   *
   * Stat cards, charts, follow-ups, tasks and the activity feed together —
   * six requests would mean six round trips before the screen is usable, and
   * the counters are a single cached read anyway.
   */
  @Get()
  @Can(MODULES.DASHBOARD, ACTIONS.VIEW)
  async get(): Promise<DashboardPayload> {
    return this.dashboard.getDashboard();
  }
}

@Controller('search')
class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Global search behind Ctrl+K (§17, W-32). Debounced 150 ms client-side. */
  @Get()
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async query(@Query('q') q = '', @Query('limit') limit?: string): Promise<SearchResults> {
    return this.search.search(q, limit ? Math.min(Number(limit), 50) : 20);
  }
}

@Module({
  controllers: [DashboardController, SearchController],
  providers: [DashboardService, SearchService],
  exports: [DashboardService, SearchService],
})
export class DashboardModule {}

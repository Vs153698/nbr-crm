import { Logger, type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { DOCS_PATH } from '../common/constants';
import { buildOpenApiDocument, reconcileDocs } from './openapi.builder';

/**
 * Mount the interactive API reference and the raw spec.
 *
 * Serving the document from the running application, rather than from a
 * checked-in file, is what keeps it honest: the paths, verbs and permissions in
 * it are read out of the live router and the live guards.
 */
export function setupDocs(
  app: INestApplication,
  options: { serverUrl: string; isProduction: boolean },
): void {
  const logger = new Logger('Docs');
  const document = buildOpenApiDocument(app, { serverUrl: options.serverUrl });

  const { undocumented, orphaned, total } = reconcileDocs(app);

  if (undocumented.length > 0 || orphaned.length > 0) {
    const detail = [
      undocumented.length > 0 ? `undocumented routes: ${undocumented.join(', ')}` : '',
      orphaned.length > 0 ? `docs with no route: ${orphaned.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');

    // Loud in development, where it is cheap to fix. A stale API document is
    // worse than no document, because people believe it.
    if (options.isProduction) {
      logger.warn(`OpenAPI registry out of sync — ${detail}`);
    } else {
      throw new Error(
        `OpenAPI registry is out of sync with the router (${detail}).\n` +
          'Add or remove the entry in src/docs/openapi.registry.ts.',
      );
    }
  }

  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: `${DOCS_PATH}/json`,
    yamlDocumentUrl: `${DOCS_PATH}/yaml`,
    customSiteTitle: 'NBR CRM API reference',
    swaggerOptions: {
      // Endpoints are grouped by tag and there are a hundred of them; expanding
      // every one on load buries the structure.
      docExpansion: 'none',
      filter: true,
      persistAuthorization: true,
      tagsSorter: 'alpha',
      // Try-it-out has to send the session cookie, or every call 401s.
      withCredentials: true,
    },
  });

  logger.log(`API reference on /${DOCS_PATH} (${total} routes documented)`);
}

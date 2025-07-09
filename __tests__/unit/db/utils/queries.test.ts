import { db } from '../../../../src/db/knex';
import CompositeCursor from '../../../../src/db/utils/CompositeCursor';
import { applyCompositeCursorFilter } from '../../../../src/db/utils/queries';

describe('applyCompositeCursorFilter', () => {
    const createCursor = (id: string, date: string): CompositeCursor =>
        new CompositeCursor({ lastPreviousId: id, lastDate: date });

    it('generates correct SQL for asc direction without prefix', () => {
        const cursor = createCursor('100', '2024-01-01 10:00:00');
        const query = db('launchpad_token_results').select('*');

        applyCompositeCursorFilter(query, cursor, '', 'asc');

        const { sql, bindings } = query.toSQL();

        expect(sql).toContain('where (`created_at` > ? or (`created_at` = ? and `id` > ?))');
        expect(bindings).toEqual(['2024-01-01 10:00:00', '2024-01-01 10:00:00', 100]);
    });

    it('generates correct SQL for desc direction with prefix', () => {
        const cursor = createCursor('42', '2023-12-12 08:30:00');
        const query = db('launchpad_token_results').select('*');

        applyCompositeCursorFilter(query, cursor, 'launchpad_token_results', 'desc');

        const { sql, bindings } = query.toSQL();

        expect(sql).toContain(
            'where (`launchpad_token_results`.`created_at` < ? or (`launchpad_token_results`.`created_at` = ? and `launchpad_token_results`.`id` < ?))',
        );
        expect(bindings).toEqual(['2023-12-12 08:30:00', '2023-12-12 08:30:00', 42]);
    });

    it('throws if id is not a number', () => {
        const cursor = createCursor('not-a-number', '2024-01-01 10:00:00');
        const query = db('launchpad_token_results').select('*');

        expect(() => applyCompositeCursorFilter(query, cursor, '', 'asc')).toThrow(
            'lastPreviousId in cursor must be a number.',
        );
    });
});

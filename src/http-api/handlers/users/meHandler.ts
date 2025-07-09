import { Response as ExpressResponse, Request } from 'express';

import { db } from '@src/db/knex';
import { Tables } from '@src/db/tables';
import { User } from '@src/db/types';

import { ExtendedRequest } from '../../types';

export default async (req: Request, res: ExpressResponse) => {
    const user = await db
        .table(Tables.Users)
        .select()
        .where({
            id: (req as ExtendedRequest).jwtPayload!.userId,
        })
        .first<User>();

    if (!user) {
        res.status(404).send();
        return;
    }

    res.status(200).json({
        id: user.id,
        name: user.name,
        email: user.email,
        config: {
            permissions: [],
        },
    });
};

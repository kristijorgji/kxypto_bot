import { Response as ExpressResponse, Request } from 'express';

import { getUserById } from '@src/db/repositories/users';

import { ExtendedRequest, MeUser } from '../../types';

export default async (req: Request, res: ExpressResponse) => {
    const user = await getUserById((req as ExtendedRequest).jwtPayload!.userId);

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
    } satisfies MeUser);
};

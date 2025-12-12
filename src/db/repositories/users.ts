import { db } from '@src/db/knex';
import { Tables } from '@src/db/tables';
import { User } from '@src/db/types';
import { OtherUser } from '@src/http-api/types';

export async function getUserById(userId: string): Promise<User | null> {
    const user = await db
        .table(Tables.Users)
        .select()
        .where({
            id: userId,
        })
        .first<User>();

    return user ?? null;
}

export async function getOtherUserById(id: string): Promise<OtherUser> {
    const r = await db.table(Tables.Users).select<OtherUser>(['id', 'name', 'username']).where('id', id).first();
    if (!r) {
        throw new Error(`User with id ${id} was not found`);
    }

    return r;
}

export async function getOtherUsersByIds(userIds: string[]): Promise<OtherUser[]> {
    return db(Tables.Users).whereIn('id', userIds).select(['id', 'name', 'username']);
}

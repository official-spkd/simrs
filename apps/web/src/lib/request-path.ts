/**
 * Header yang diisi proxy dengan path + query asli permintaan (nilai kiriman klien selalu ditimpa), agar DAL di
 * Server Component tahu tujuan kembali setelah login.
 */
export const PATH_HEADER = 'x-simrs-path';

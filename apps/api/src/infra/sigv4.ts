// Penanda tangan SigV4 kini di @simrs/shared/node (dipakai juga backup, ADR-0071); berkas ini menjaga impor lama.
export {
  amzDate,
  canonicalQuery,
  EMPTY_SHA256,
  encodeS3Path,
  signV4,
  uriEncode,
  type SignedRequest,
  type SigV4Credentials,
  type SigV4Input,
} from '@simrs/shared/node';

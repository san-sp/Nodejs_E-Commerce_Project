ALTER TYPE public."productStatus"
RENAME TO "ProductStatus";

ALTER TYPE public."ProductStatus"
RENAME VALUE 'ARCHIEVED' TO 'ARCHIVED';

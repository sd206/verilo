# ClamAV with a small HTTP front end. Used by docker-compose locally and by the Cloud Run
# service `clamav` (internal ingress only) in staging and production.
FROM clamav/clamav:1.5.4

RUN apk add --no-cache nodejs
# Accept streams up to 20 MB (uploads are capped at 15 MB).
RUN sed -i '/^#\{0,1\}StreamMaxLength/d' /etc/clamav/clamd.conf \
 && echo 'StreamMaxLength 20M' >> /etc/clamav/clamd.conf

WORKDIR /app
COPY server.mjs entrypoint.sh /app/
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]

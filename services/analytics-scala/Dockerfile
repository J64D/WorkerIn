FROM sbtscala/scala-sbt:latest
WORKDIR /app
COPY build.sbt ./
COPY project ./project
RUN sbt -batch update
COPY src ./src
RUN sbt -batch compile
EXPOSE 8091
CMD ["sbt", "-batch", "run"]

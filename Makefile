#!make

seed:
	yarn seed:run

refreshdb:
	yarn migrate:rollback && yarn migrate:latest

refreshdbseed:
	make refreshdb && make seed

.PHONY: seed refreshdb refreshdbseed

from decimal import Decimal

from django.db import migrations, models


def seed_distance_conversion_settings(apps, schema_editor):
    DistanceConversionSettings = apps.get_model("app_workout", "DistanceConversionSettings")
    CardioUnit = apps.get_model("app_workout", "CardioUnit")

    if not DistanceConversionSettings.objects.exists():
        DistanceConversionSettings.objects.create(
            ten_k_miles=6.21371192,
            x800_miles=0.5,
            x800_meters=800.0,
            x800_yards=880.0,
            x400_miles=0.25,
            x400_meters=400.0,
            x400_yards=440.0,
            x200_miles=0.125,
            x200_meters=200.0,
            x200_yards=220.0,
        )

    for unit_name, miles in (
        ("800m Intervals", Decimal("0.5")),
        ("400m Intervals", Decimal("0.25")),
        ("200m Intervals", Decimal("0.125")),
    ):
        unit = CardioUnit.objects.filter(name=unit_name).first()
        if unit is None:
            continue
        unit.mile_equiv_numerator = miles
        unit.mile_equiv_denominator = Decimal("1")
        unit.save(update_fields=["mile_equiv_numerator", "mile_equiv_denominator"])


def unseed_distance_conversion_settings(apps, schema_editor):
    DistanceConversionSettings = apps.get_model("app_workout", "DistanceConversionSettings")
    DistanceConversionSettings.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0051_strengthvolumebucket_and_drop_strengthprogressions"),
    ]

    operations = [
        migrations.CreateModel(
            name="DistanceConversionSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("ten_k_miles", models.FloatField(default=6.21371192)),
                ("x800_miles", models.FloatField(default=0.5)),
                ("x800_meters", models.FloatField(default=800.0)),
                ("x800_yards", models.FloatField(default=880.0)),
                ("x400_miles", models.FloatField(default=0.25)),
                ("x400_meters", models.FloatField(default=400.0)),
                ("x400_yards", models.FloatField(default=440.0)),
                ("x200_miles", models.FloatField(default=0.125)),
                ("x200_meters", models.FloatField(default=200.0)),
                ("x200_yards", models.FloatField(default=220.0)),
            ],
            options={
                "verbose_name": "Distance Conversion Settings",
                "verbose_name_plural": "Distance Conversion Settings",
            },
        ),
        migrations.RunPython(seed_distance_conversion_settings, unseed_distance_conversion_settings),
    ]

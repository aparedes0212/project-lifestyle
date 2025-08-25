from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0010_remove_strengthexercise_default_weight"),
    ]

    operations = [
        migrations.AlterField(
            model_name="strengthdailylog",
            name="max_reps",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
